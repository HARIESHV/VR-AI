import os
import asyncio
import json
import base64
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .ai import build_insights, detect_duplicates, suggest_group
from .database import engine, get_db
from .security import create_access_token, decode_access_token, hash_password, verify_password

# Google API Imports (for sync)
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request as GoogleRequest

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")


app = FastAPI(title="VR AI – Intelligent Contact Manager", version="3.0.0")
auth_scheme = HTTPBearer()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ──────────────────────────────────────────

class RegisterIn(BaseModel):
    name: str | None = None
    email: EmailStr
    password: str = Field(min_length=8)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ContactIn(BaseModel):
    name: str
    phone: str
    email: str | None = None
    tag: str | None = None

class CallIn(BaseModel):
    phone: str
    type: str = Field(pattern="^(incoming|outgoing|missed)$")
    duration: int = Field(default=0, ge=0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ── Dependencies ────────────────────────────────────

def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
) -> UUID:
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        return UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

# ── Auth Endpoints ──────────────────────────────────

@app.post("/auth/register")
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    existing = db.execute(
        text("SELECT id FROM users WHERE email = :email"),
        {"email": payload.email.lower()},
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")

    row = db.execute(
        text(
            """
            INSERT INTO users (name, email, password_hash)
            VALUES (:name, :email, :password_hash)
            RETURNING id, email, name
            """
        ),
        {
            "name": payload.name,
            "email": payload.email.lower(),
            "password_hash": hash_password(payload.password)
        },
    ).first()
    db.commit()
    token = create_access_token(str(row.id))
    return {"access_token": token, "token_type": "bearer", "user": {"email": row.email, "name": row.name}}

@app.post("/auth/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(
        text("SELECT id, email, name, password_hash FROM users WHERE email = :email"),
        {"email": payload.email.lower()},
    ).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(str(user.id))
    return {"access_token": token, "token_type": "bearer", "user": {"email": user.email, "name": user.name}}

# ── Contacts Endpoints ──────────────────────────────

@app.get("/contacts")
def list_contacts(user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT * FROM contacts WHERE user_id = :user_id ORDER BY name ASC"),
        {"user_id": str(user_id)},
    ).mappings().all()
    return {"items": rows}

@app.post("/contacts")
def upsert_contact(payload: ContactIn, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    db.execute(
        text(
            """
            INSERT INTO contacts (user_id, name, phone, email, tag)
            VALUES (:user_id, :name, :phone, :email, :tag)
            ON CONFLICT (user_id, phone) 
            DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, tag = EXCLUDED.tag
            """
        ),
        {
            "user_id": str(user_id),
            "name": payload.name,
            "phone": payload.phone,
            "email": payload.email,
            "tag": payload.tag,
        },
    )
    db.commit()
    return {"message": "Contact saved"}

@app.delete("/contacts/{phone}")
def delete_contact(phone: str, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    db.execute(
        text("DELETE FROM contacts WHERE user_id = :user_id AND phone = :phone"),
        {"user_id": str(user_id), "phone": phone},
    )
    db.commit()
    return {"message": "Contact deleted"}

# ── Calls Endpoints ─────────────────────────────────

@app.get("/calls")
def list_calls(user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT c.id, c.phone, c.type, c.duration, c.timestamp, con.name as contact_name
            FROM call_logs c
            LEFT JOIN contacts con ON c.contact_id = con.id
            WHERE c.user_id = :user_id
            ORDER BY c.timestamp DESC
            LIMIT 100
            """
        ),
        {"user_id": str(user_id)},
    ).mappings().all()
    return {"items": rows}

@app.post("/calls")
def log_call(payload: CallIn, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    # Try to find contact_id
    contact = db.execute(
        text("SELECT id FROM contacts WHERE user_id = :user_id AND phone = :phone"),
        {"user_id": str(user_id), "phone": payload.phone}
    ).first()
    
    contact_id = contact.id if contact else None

    db.execute(
        text(
            """
            INSERT INTO call_logs (user_id, contact_id, phone, type, duration, timestamp)
            VALUES (:user_id, :contact_id, :phone, :type, :duration, :timestamp)
            """
        ),
        {
            "user_id": str(user_id),
            "contact_id": contact_id,
            "phone": payload.phone,
            "type": payload.type,
            "duration": payload.duration,
            "timestamp": payload.timestamp,
        },
    )
    db.commit()
    return {"message": "Call logged"}

# ── AI Endpoints ────────────────────────────────────

@app.get("/ai/suggestions")
def get_ai_suggestions(user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    # 1. Unknown number name suggestions (Simulated or based on AI suggestions table)
    suggestions = db.execute(
        text("SELECT phone, suggested_name, confidence_score FROM ai_suggestions WHERE user_id = :user_id"),
        {"user_id": str(user_id)}
    ).mappings().all()

    # 2. Duplicate detection
    contacts = db.execute(
        text("SELECT id, name, phone, email FROM contacts WHERE user_id = :user_id"),
        {"user_id": str(user_id)}
    ).mappings().all()
    duplicates = detect_duplicates(list(contacts))

    # 3. Frequency insights
    calls = db.execute(
        text("SELECT phone, type, timestamp FROM call_logs WHERE user_id = :user_id"),
        {"user_id": str(user_id)}
    ).mappings().all()
    insights = build_insights(list(calls))

    return {
        "name_suggestions": suggestions,
        "duplicate_suggestions": duplicates,
        "insights": insights
    }

@app.post("/ai/suggest-name")
def ai_suggest_name(phone: str, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    """Simulate AI finding a name for an unknown number."""
    # In a real app, this might call an external API or look at global patterns
    simulated_names = {
        "9876543210": "James Smith",
        "1234567890": "Tech Support",
        "5550199": "Pizza Delivery",
    }
    name = simulated_names.get(phone.replace("+", "").replace(" ", ""), "Unknown Caller")
    
    # Store it
    db.execute(
        text(
            """
            INSERT INTO ai_suggestions (user_id, phone, suggested_name, confidence_score)
            VALUES (:user_id, :phone, :name, 0.9)
            ON CONFLICT (user_id, phone) DO UPDATE SET suggested_name = EXCLUDED.suggested_name
            """
        ),
        {"user_id": str(user_id), "phone": phone, "name": name}
    )
    db.commit()
    return {"name": name, "confidence": 0.9}

@app.get("/ai/group-suggestion/{phone}")
def get_group_suggestion(phone: str, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    contact = db.execute(
        text("SELECT * FROM contacts WHERE user_id = :user_id AND phone = :phone"),
        {"user_id": str(user_id), "phone": phone}
    ).mappings().first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
        
    calls = db.execute(
        text("SELECT phone, timestamp FROM call_logs WHERE user_id = :user_id AND phone = :phone"),
        {"user_id": str(user_id), "phone": phone}
    ).mappings().all()
    
    suggested_tag = suggest_group(dict(contact), list(calls))
    return {"phone": phone, "suggested_tag": suggested_tag}

# ── Google Sync Endpoints ──────────────────────────

@app.get("/auth/google/start")
def google_auth_start(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [GOOGLE_REDIRECT_URI],
            }
        },
        scopes=["https://www.googleapis.com/auth/contacts.readonly"],
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI
    
    # We pass the user_id in 'state' so we know who they are when they return
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=user_id
    )
    return {"authorization_url": authorization_url}

@app.get("/auth/google/callback")
def google_auth_callback(code: str, state: str, db: Session = Depends(get_db)):
    user_id = state  # The user_id we passed in 'state'
    
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [GOOGLE_REDIRECT_URI],
            }
        },
        scopes=["https://www.googleapis.com/auth/contacts.readonly"],
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI
    flow.fetch_token(code=code)
    
    credentials = flow.credentials
    service = build("people", "v1", credentials=credentials)
    
    # Fetch contacts
    results = service.people().connections().list(
        resourceName="people/me",
        pageSize=1000,
        personFields="names,phoneNumbers,emailAddresses",
    ).execute()
    
    connections = results.get("connections", [])
    synced_count = 0
    
    for person in connections:
        name = person.get("names", [{}])[0].get("displayName", "Unnamed Contact")
        phones = person.get("phoneNumbers", [])
        emails = person.get("emailAddresses", [])
        
        email = emails[0].get("value") if emails else None
        
        for p in phones:
            phone_num = p.get("value")
            if not phone_num: continue
            
            # Upsert into DB
            db.execute(
                text(
                    """
                    INSERT INTO contacts (user_id, name, phone, email, tag)
                    VALUES (:user_id, :name, :phone, :email, 'google')
                    ON CONFLICT (user_id, phone) 
                    DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, tag = 'google'
                    """
                ),
                {
                    "user_id": user_id,
                    "name": name,
                    "phone": phone_num,
                    "email": email,
                },
            )
            synced_count += 1
            
    db.commit()
    
    # Redirect back to frontend with a success flag
    return RedirectResponse(url="/?sync=success")

# ── Static Files ────────────────────────────────────

_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
_FRONTEND_DIR = os.path.abspath(_FRONTEND_DIR)

if os.path.exists(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
else:
    @app.get("/")
    def root():
        return {"message": "Frontend directory not found. Please build the frontend."}

# ── Health ──────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}

