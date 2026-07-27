# Save this as: run-local.sh
#!/bin/bash

set -e

# Configuration
export ORCA_CLI_PATH=/home/odin/local/orcaslicerWebUI/squashfs-root/bin/orca-slicer
export WORKSPACE_ROOT=/tmp/orca-workspace
export USER_WORKSPACE=/tmp/orca-workspace/user_configs
export MAX_CONCURRENT_JOBS=4
export JOB_TIMEOUT_SECONDS=3600
export OUTPUT_RETENTION_SECONDS=86400
export JOB_RECORD_RETENTION_SECONDS=604800
export API_SECRET=test-secret-key

# Create workspace directories
mkdir -p $USER_WORKSPACE
mkdir -p $USER_WORKSPACE/autosave
mkdir -p $USER_WORKSPACE/printer/autosave
mkdir -p $USER_WORKSPACE/filament/autosave
mkdir -p $USER_WORKSPACE/process/autosave

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting OrcaSlicer Web UI (local mode)${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Shutting down...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${BLUE}Starting backend on port 8000...${NC}"
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI/backend
source ../../.venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to start
sleep 3

# Start frontend
echo -e "${BLUE}Starting frontend on port 5173...${NC}"
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI/frontend
VITE_API_SECRET=$API_SECRET npm run dev &
FRONTEND_PID=$!

echo -e "${GREEN}✅ Both services started!${NC}"
echo -e "${BLUE}Backend:  http://localhost:8000${NC}"
echo -e "${BLUE}Frontend: http://localhost:5173${NC}"
echo -e "\nPress Ctrl+C to stop both services"

# Wait for processes
wait $BACKEND_PID $FRONTEND_PID
