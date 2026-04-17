#!/bin/bash
set -euo pipefail

# Ensure user-installed scripts are available on Render.
export PATH="$HOME/.local/bin:$PATH"

echo "--- Starting Server Phase ---"
if command -v gunicorn >/dev/null 2>&1; then
    echo "Starting with Gunicorn..."
    exec gunicorn backend.app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind "0.0.0.0:${PORT:-10000}"
else
    echo "Gunicorn not found, falling back to Uvicorn..."
    exec python -m uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
fi
