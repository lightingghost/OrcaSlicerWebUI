#!/bin/bash
# Entrypoint for the combined OrcaSlicer Web UI container.
# Starts the FastAPI/uvicorn backend and nginx (serving the frontend +
# proxying /api and /ws to the backend) as sibling processes, and exits
# (taking the container down) if either one dies.
set -euo pipefail

: "${WORKSPACE_ROOT:=/app/workspace}"
: "${USER_WORKSPACE:=${WORKSPACE_ROOT}/user_configs}"

mkdir -p \
  "${USER_WORKSPACE}/autosave" \
  "${USER_WORKSPACE}/printer/autosave" \
  "${USER_WORKSPACE}/filament/autosave" \
  "${USER_WORKSPACE}/process/autosave"

cleanup() {
  echo "Shutting down..."
  kill -TERM "${BACKEND_PID:-}" "${NGINX_PID:-}" 2>/dev/null || true
  wait "${BACKEND_PID:-}" "${NGINX_PID:-}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting backend (uvicorn) on 127.0.0.1:8000..."
cd /app/backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Starting nginx on :80..."
nginx -g "daemon off;" &
NGINX_PID=$!

# If either process exits, bring the container down so orchestrators
# (docker restart policy / k8s) can restart it.
wait -n "${BACKEND_PID}" "${NGINX_PID}"
cleanup
