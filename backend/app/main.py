import os
import asyncio
from datetime import datetime
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .ai import build_insights
from .database import engine, get_db
from .security import create_access_token, decode_access_token, hash_password, verify_password

app = FastAPI(title="VR AI – Intelligent Call Assistant API", version="2.0.0")
auth_scheme = HTTPBearer()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Keep Database Always Active ────────────────────────
async def keep_db_alive():
    while True:
        try:
            if engine:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
        except Exception:
            pass
        await asyncio.sleep(60)  # Ping every 60 seconds

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(keep_db_alive())

# ── Serve frontend static files ────────────────────────

_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
_FRONTEND_DIR = os.path.abspath(_FRONTEND_DIR)



class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ConsentIn(BaseModel):
    call_tracking_consent: bool
    location_tracking_consent: bool


class CallLogIn(BaseModel):
    phone_number: str
    direction: str = Field(pattern="^(incoming|outgoing|missed)$")
    duration_seconds: int = Field(ge=0)
    call_time: datetime
    source: str = "manual"
    is_spam_reported: bool = False


class LocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)
    recorded_at: datetime


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


@app.get("/health")
def health():
    return {"status": "ok"}


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
            INSERT INTO users (email, password_hash)
            VALUES (:email, :password_hash)
            RETURNING id, email
            """
        ),
        {"email": payload.email.lower(), "password_hash": hash_password(payload.password)},
    ).first()
    db.commit()
    token = create_access_token(str(row.id))
    return {"access_token": token, "token_type": "bearer", "email": row.email}


@app.post("/auth/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(
        text("SELECT id, email, password_hash FROM users WHERE email = :email"),
        {"email": payload.email.lower()},
    ).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(str(user.id))
    return {"access_token": token, "token_type": "bearer", "email": user.email}


@app.post("/consent")
def update_consent(
    payload: ConsentIn,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    db.execute(
        text(
            """
            UPDATE users
            SET call_tracking_consent = :call_consent,
                location_tracking_consent = :location_consent
            WHERE id = :user_id
            """
        ),
        {
            "call_consent": payload.call_tracking_consent,
            "location_consent": payload.location_tracking_consent,
            "user_id": str(user_id),
        },
    )
    db.commit()
    return {"message": "Consent preferences updated"}


@app.get("/consent")
def get_consent(user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_db)):
    row = db.execute(
        text(
            """
            SELECT call_tracking_consent, location_tracking_consent
            FROM users WHERE id = :user_id
            """
        ),
        {"user_id": str(user_id)},
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "call_tracking_consent": row.call_tracking_consent,
        "location_tracking_consent": row.location_tracking_consent,
    }


@app.post("/call-logs")
def create_call_log(
    payload: CallLogIn,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    consent = db.execute(
        text("SELECT call_tracking_consent FROM users WHERE id = :user_id"),
        {"user_id": str(user_id)},
    ).first()
    if not consent or not consent.call_tracking_consent:
        raise HTTPException(status_code=403, detail="Call tracking consent not enabled")

    db.execute(
        text(
            """
            INSERT INTO call_logs (user_id, phone_number, direction, duration_seconds, call_time, source, is_spam_reported)
            VALUES (:user_id, :phone_number, :direction, :duration_seconds, :call_time, :source, :is_spam_reported)
            """
        ),
        {
            "user_id": str(user_id),
            "phone_number": payload.phone_number,
            "direction": payload.direction,
            "duration_seconds": payload.duration_seconds,
            "call_time": payload.call_time,
            "source": payload.source,
            "is_spam_reported": payload.is_spam_reported,
        },
    )
    db.commit()
    return {"message": "Call log created"}


@app.post("/location")
def create_location(
    payload: LocationIn,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    consent = db.execute(
        text("SELECT location_tracking_consent FROM users WHERE id = :user_id"),
        {"user_id": str(user_id)},
    ).first()
    if not consent or not consent.location_tracking_consent:
        raise HTTPException(status_code=403, detail="Location tracking consent not enabled")

    db.execute(
        text(
            """
            INSERT INTO location_data (user_id, latitude, longitude, accuracy_meters, recorded_at)
            VALUES (:user_id, :latitude, :longitude, :accuracy_meters, :recorded_at)
            """
        ),
        {
            "user_id": str(user_id),
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "accuracy_meters": payload.accuracy_meters,
            "recorded_at": payload.recorded_at,
        },
    )
    db.commit()
    return {"message": "Location point stored"}


@app.get("/dashboard/calls")
def list_calls(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            """
            SELECT id, phone_number, direction, duration_seconds, call_time, source, is_spam_reported
            FROM call_logs
            WHERE user_id = :user_id
            ORDER BY call_time DESC
            LIMIT 200
            """
        ),
        {"user_id": str(user_id)},
    ).mappings().all()
    return {"items": rows}


@app.get("/dashboard/locations")
def list_locations(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            """
            SELECT id, latitude, longitude, accuracy_meters, recorded_at
            FROM location_data
            WHERE user_id = :user_id
            ORDER BY recorded_at DESC
            LIMIT 500
            """
        ),
        {"user_id": str(user_id)},
    ).mappings().all()
    return {"items": rows}


@app.get("/dashboard/insights")
def get_insights(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    call_rows = db.execute(
        text(
            """
            SELECT phone_number, direction, duration_seconds, call_time, is_spam_reported
            FROM call_logs
            WHERE user_id = :user_id
            ORDER BY call_time DESC
            LIMIT 2000
            """
        ),
        {"user_id": str(user_id)},
    ).mappings().all()

    return build_insights(list(call_rows))


# ── AI Endpoints ──────────────────────────────────────
class AIReplyIn(BaseModel):
    text: str


class AISummarizeIn(BaseModel):
    transcript: str
    duration: int = 0


_REPLY_RULES = {
    "meeting":  "Sounds good! I'll prepare the agenda and be ready on time.",
    "tomorrow": "I'll have everything set for tomorrow. No worries!",
    "time":     "That time works perfectly for me. I'll set a reminder.",
    "schedule": "Let me check the calendar. What date works best for you?",
    "price":    "I can look into the pricing details and send you a summary shortly.",
    "problem":  "Let's work through this together and find the best solution.",
    "help":     "Of course! I'd be happy to assist you with that.",
    "sorry":    "No worries at all — these things happen!",
    "thanks":   "You're very welcome! Let me know if you need anything else.",
    "bye":      "It was great talking with you. Have a wonderful day!",
    "call":     "I'm glad you called. How can I help further?",
    "great":    "That's wonderful to hear! Is there anything else you need?",
}

_DEFAULT_REPLIES = [
    "That's an interesting point. Could you tell me more?",
    "I understand completely. Let me think about the best next step.",
    "Thanks for bringing that up. I'll look into it right away.",
    "Absolutely — I'll take care of that for you.",
    "That makes total sense. What would you suggest we do next?",
]


@app.post("/ai/reply")
def ai_reply(payload: AIReplyIn):
    """Generate a smart context-aware reply suggestion."""
    lc = payload.text.lower()
    for keyword, reply in _REPLY_RULES.items():
        if keyword in lc:
            return {"reply": reply, "source": "rule"}
    import random
    return {"reply": random.choice(_DEFAULT_REPLIES), "source": "default"}


@app.post("/ai/summarize")
def ai_summarize(payload: AISummarizeIn):
    """Generate a concise AI call summary from the transcript."""
    lines = [l.strip() for l in payload.transcript.strip().splitlines() if l.strip()]
    speakers = set()
    for line in lines:
        if ": " in line:
            speakers.add(line.split(": ")[0])

    dur_m = payload.duration // 60
    dur_s = payload.duration % 60
    duration_str = f"{dur_m}m {dur_s}s" if dur_m else f"{dur_s}s"

    # Extract key topics
    topics_found = []
    for kw in ["meeting", "schedule", "price", "problem", "help", "tomorrow", "time"]:
        if any(kw in l.lower() for l in lines):
            topics_found.append(kw)

    topic_str = ", ".join(topics_found[:3]) if topics_found else "general conversation"
    line_count = len(lines)
    speaker_str = " and ".join(list(speakers)[:2]) if speakers else "the participants"

    summary = (
        f"VR AI transcribed a {duration_str} call between {speaker_str} covering {topic_str}. "
        f"A total of {line_count} exchanges were recorded. "
        f"VR AI provided real-time assistance including call screening, "
        f"live transcription, and smart reply suggestions throughout the call."
    )
    return {"summary": summary, "topics": topics_found, "line_count": line_count}


app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
