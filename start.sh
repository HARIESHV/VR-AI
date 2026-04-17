#!/bin/bash
set -euo pipefail

# Prefer local virtualenv binaries created during Render build.
if [ -d ".venv/bin" ]; then
    export PATH="$(pwd)/.venv/bin:$PATH"
fi

echo "--- Starting Server Phase ---"
if [ -x ".venv/bin/gunicorn" ]; then
    echo "Starting with Gunicorn..."
    exec .venv/bin/gunicorn backend.app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind "0.0.0.0:${PORT:-10000}"
else
    echo "Gunicorn not found, falling back to Uvicorn..."
    exec python -m uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
fi
