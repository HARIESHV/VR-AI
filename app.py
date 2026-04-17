import os
from backend.app.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 Starting VR AI Server on port {port}...")
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=port, reload=False)
