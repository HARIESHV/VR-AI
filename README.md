# AI Sentinel PWA (Mobile-First)

A privacy-focused AI-powered web app with:
- FastAPI backend + JWT auth
- Neon PostgreSQL persistence
- Mobile-first PWA frontend
- Explicit consent gates for call and location logging
- Real-time location tracking only while user keeps tracking enabled
- AI insights for suspicious call behavior

## 1) Architecture Diagram (Text)

```text
 [User on Mobile Browser / Android WebView]
                |
                v
      [PWA Frontend: HTML/CSS/JS]
  - Auth screens (JWT login/register)
  - Consent controls (call + location)
  - Manual call log input
  - Start/Stop geolocation toggle
  - Dashboard (history, map-ready timeline, AI panel)
                |
                | HTTPS REST API (Bearer JWT)
                v
        [FastAPI Backend (Python)]
  - Auth + JWT issuance/verification
  - Consent enforcement on data endpoints
  - Call/location ingestion endpoints
  - AI analysis endpoint (rule-based baseline)
                |
                v
        [Neon PostgreSQL Database]
  - users
  - call_logs
  - location_data
```

## 2) Folder Structure

```text
ai-sentinel-pwa/
  backend/
    app/
      main.py
      database.py
      security.py
      ai.py
    requirements.txt
  frontend/
    index.html
    styles.css
    app.js
    manifest.json
    sw.js
  db/
    schema.sql
  capacitor.config.json
  README.md
```

## 3) Local Setup

### Backend
1. Create `.env` in `backend/`:

```env
DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>/<db>?sslmode=require
JWT_SECRET=<strong-random-secret>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
```

2. Install and run:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
Serve static files from `frontend/` with any static server (or host on Vercel):

```bash
cd frontend
python -m http.server 5173
```

Open `http://localhost:5173`.

## 4) Deployment Steps

### Neon (Database)
1. Create Neon project and database.
2. Run `db/schema.sql`.
3. Copy connection string and set as `DATABASE_URL` in backend host.

### Render (FastAPI)
1. Create new Web Service from repo.
2. Root directory: `backend`.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add env vars: `DATABASE_URL`, `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`.
6. Enable HTTPS (default on Render).

### Vercel (Frontend)
1. Import repo.
2. Set root to `frontend`.
3. Deploy static frontend.
4. Update `API_BASE_URL` in `frontend/app.js` to Render API URL.

## 5) Convert PWA to Android APK (Capacitor)

1. Install Node.js + Android Studio.
2. From project root:

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init AISentinel com.example.aisentinel
```

3. Build/copy frontend assets into a `www/` folder (or point Capacitor to `frontend` output).
4. Add Android platform:

```bash
npx cap add android
npx cap sync android
npx cap open android
```

5. In Android Studio: Build > Generate Signed Bundle/APK.

For native call-log integration, add a custom Android plugin with runtime permissions (`READ_CALL_LOG`), and keep explicit in-app consent toggles.

## 6) Browser Limitations vs Native Android

- Browser cannot access full device call logs directly.
- Browser geolocation works only with user permission and active page context; background behavior is limited by OS/browser.
- Native Android can read call logs (with permission) and provide more reliable background location workflows, but must comply with Play policies and explicit consent.
- PWA is faster to ship and cross-platform; native integration is better for deep OS-level telemetry.

## 7) Privacy & Security Notes

- Tracking endpoints enforce explicit user consent flags.
- No automatic background collection in this starter.
- JWT auth required on protected endpoints.
- Use HTTPS in production.
- For stronger protection, store encrypted columns for sensitive fields and rotate JWT secrets regularly.
