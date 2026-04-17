# VR AI – Intelligent Call Assistant Prototype (Mobile-First)

VR AI is a privacy-focused, AI-powered call management simulation. It provides a native mobile-app experience via a responsive web interface, featuring a persistent database backend with Neon PostgreSQL and AI-enhanced features like screening, transcription, and smart reply suggestions.

## 🚀 Core Features

1.  **AI Dialer & Contact Management**: Modern, premium dialer with haptic feedback and full CRUD for contacts.
2.  **Call Simulation Engine**: Simulated incoming and outgoing call workflows with realistic UI.
3.  **VR AI Call Screening**: AI-driven screening process for unknown callers with live transcription hints.
4.  **Live Transcription & Waveforms**: Interactive active call screen with real-time waveform visualization and AI speech-to-text.
5.  **Smart AI Replies**: Context-aware reply suggestions powered by backend AI logic.
6.  **AI Call Summary**: Automatic post-call insights and summary derivation based on call context.
7.  **Auth System**: Secure JWT-based authentication for persistent data storage.

## 📂 Project Structure

```text
vr-ai/
  backend/
    app/
      main.py        # FastAPI Entry & Endpoints
      database.py    # SQLAlchemy Neon Connection
      security.py    # JWT & Hashing Logic
      ai.py          # AI Analysis Logic
    requirements.txt # Python Dependencies
  frontend/
    index.html       # Mobile-first Glassmorphism UI
    styles.css       # Premium CSS Design System
    app.js           # Core Simulation Logic & API Integration
    manifest.json    # PWA Configuration
  db/
    schema.sql       # PostgreSQL Schema (Neon Optimized)
  app.py             # Render/Production Entry Point
  render.yaml        # Infrastructure as Code (Render Blueprint)
  requirements.txt   # Root Dependencies for Render
  README.md          # Documentation
```

## 🛠️ Setup Instructions

### 1. Database Setup (Neon)
1. Create a free project at [Neon.tech](https://neon.tech).
2. Create a new database named `vrai`.
3. Execute the SQL commands in `db/schema.sql` within the Neon SQL Editor.

### 2. Backend Configuration
1. Create `.env` inside the `backend/` directory:
```env
DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>/vrai?sslmode=require
JWT_SECRET=your_super_secret_key
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
FRONTEND_REDIRECT_ON_SYNC=/
```

### 3. Local Execution
**Backend:**
```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```

**Frontend:**
Serve the `frontend` folder using any static server (e.g., Live Server or `python -m http.server 5173`).

## ☁️ Deployment (Render)

This project is pre-configured for one-click deployment on Render:

1. Push this repository to GitHub.
2. In Render, select **New > Blueprint**.
3. Connect this repository.
4. Render will use the `render.yaml` file to automatically provision the web service with:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn backend.app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`
5. Add the environment variables (`DATABASE_URL`, `JWT_SECRET`, etc.) in the Render dashboard.

## 🛡️ Privacy & Constraints
- **Simulation Only**: This application simulates call flows for prototyping purposes.
- **No Real Calls**: It does not make real cellular or VoIP calls.
- **Ethics**: Designed to showcase AI's role in screening and assistance without compromising real user privacy.

---
Developed as a Senior Full-Stack Prototype for VR AI.
