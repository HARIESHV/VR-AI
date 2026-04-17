#!/bin/bash
# VR AI - Render Deployment Script
echo "--- Starting Build/Install Phase ---"
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "--- Starting Server Phase ---"
# Check if gunicorn is available, otherwise use uvicorn
if command -v gunicorn &> /dev/null
then
    echo "Starting with Gunicorn..."
    gunicorn backend.app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT
else
    echo "Gunicorn not found, falling back to Uvicorn..."
    python -m uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
fi
