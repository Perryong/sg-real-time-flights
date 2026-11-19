#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ] || [ ! -d frontend/node_modules ]; then
  echo 'Install the Python and frontend dependencies using README.md first.' >&2
  exit 1
fi
.venv/bin/python - <<'PY'
import socket
for port in (8017,5177):
    with socket.socket() as s:
        try:s.bind(('127.0.0.1',port))
        except OSError:raise SystemExit(f'Port {port} is already in use. Your existing services have not been changed.')
PY
if [ -f .env ]; then set -- --env-file .env; else set --; fi
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8017 "$@" &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM
npm --prefix frontend run dev
