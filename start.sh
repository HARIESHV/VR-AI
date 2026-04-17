#!/usr/bin/env bash
# exit on error
set -o errexit

python -m uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000}
