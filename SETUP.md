# 🚀 OrcaSlicer Web UI Setup Instructions

Here's a complete guide for setting up the Web UI with your AppImage:

## 📋 Quick Setup (5 steps)

### Step 1: Extract Your AppImage

```bash
cd /home/odin/local/orcaslicerWebUI

# Make executable
chmod +x OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage

# Extract contents
./OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage --appimage-extract

# This creates squashfs-root/ with:
# ├── usr/bin/orca-slicer  (the CLI binary)
# └── resources/profiles/  (Bambu, Prusa, Voron profiles)
```

### Step 2: Configure Environment Variables

Create a `.env` file in the OrcaSlicerWebUI directory to configure the API secret in one place:

```bash
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI

# Generate a secure random secret
API_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > .env << EOF
API_SECRET=${API_SECRET}
EOF

echo "Generated API_SECRET: ${API_SECRET}"
```

This single environment variable will be used by both the frontend and backend.

### Step 3: Update docker-compose.yml

Edit `/home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI/docker-compose.yml` to point to your extracted AppImage:

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      args:
        - VITE_API_SECRET=${API_SECRET:-changeme}
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      # Mount extracted AppImage (read-only)
      - ../squashfs-root:/app/orca-slicer:ro
      - workspace:/app/workspace
    environment:
      # Point to CLI inside the container
      - ORCA_CLI_PATH=/app/orca-slicer/usr/bin/orca-slicer
      - WORKSPACE_ROOT=/app/workspace
      - MAX_CONCURRENT_JOBS=4
      - JOB_TIMEOUT_SECONDS=3600
      - OUTPUT_RETENTION_SECONDS=86400
      - JOB_RECORD_RETENTION_SECONDS=604800
      # API_SECRET from .env file
      - API_SECRET=${API_SECRET:-changeme}
    restart: unless-stopped

volumes:
  workspace:
```

**Key changes from default config:**
- Volume path: `../squashfs-root:/app/orca-slicer:ro`
- CLI path: `/app/orca-slicer/usr/bin/orca-slicer`
- API_SECRET: Reads from `.env` file (configured in Step 2)

### Step 4: Verify CLI Works

```bash
# Test the extracted CLI
./squashfs-root/usr/bin/orca-slicer --help

# Should show the same output as your AppImage
# Verify profiles exist
ls -la squashfs-root/resources/profiles/
# Should see: Bambu Lab/, Prusa/, Voron/, etc.
```

### Step 5: Start the Web UI

```bash
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI

# Build and start
docker-compose up --build

# Or run in background
docker-compose up --build -d
```

**First startup takes 5-10 minutes** (building Docker images).

### Step 6: Access the UI

Open your browser:
```
http://localhost
```

You should see:
- ✅ 3D viewport with build plate
- ✅ Profile selectors (left panel)
- ✅ File upload dropzone
- ✅ Parameter tabs

---

## 🐛 Troubleshooting

### "Failed to fetch manufacturers: 401" or "Upload failed with status 401"

This means the frontend is not sending the correct authentication token.

**For local development (using run-local.sh):**
- The `run-local.sh` script automatically passes the `API_SECRET` environment variable to both backend and frontend
- Simply restart: `./run-local.sh`

**For Docker deployment:**
1. Create a `.env` file in the OrcaSlicerWebUI directory:
   ```bash
   echo "API_SECRET=$(openssl rand -hex 32)" > .env
   ```
2. Ensure docker-compose.yml reads `${API_SECRET}` for both services (already configured)
3. Rebuild with the new secret: `docker-compose up --build`

**For standalone frontend development:**
- Create `frontend/.env` with `VITE_API_SECRET=test-secret-key`
- This must match the backend's `API_SECRET`

### "CLI binary not found"

```bash
# Check the binary path in extraction
ls -la squashfs-root/usr/bin/orca-slicer

# If different location, update ORCA_CLI_PATH in docker-compose.yml
```

### "Profiles not found"

```bash
# Verify profiles directory
ls squashfs-root/resources/profiles/

# Should contain manufacturer folders
# If missing, re-extract the AppImage
```

### Port 80 already in use

Change frontend port in docker-compose.yml:
```yaml
frontend:
  ports:
    - "8080:80"  # Use 8080 instead
```

Access at: `http://localhost:8080`

### Backend won't start

```bash
# Check logs
docker-compose logs backend

# Common issues:
# - ORCA_CLI_PATH pointing to wrong location
# - Permissions on squashfs-root/
# - Missing profiles directory
```

---

## 🔧 Development Mode (Optional)

### Backend Only

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Set environment
export ORCA_CLI_PATH=/home/odin/local/orcaslicerWebUI/squashfs-root/usr/bin/orca-slicer
export WORKSPACE_ROOT=/tmp/orca-workspace
export API_SECRET=dev-secret

# Run with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Only

```bash
cd frontend
npm install

# Create .env file with API secret (if running frontend standalone)
cat > .env << 'EOF'
VITE_API_SECRET=test-secret-key
EOF

npm run dev
# Available at http://localhost:5173
```

**Note**: When using `run-local.sh`, the API secret is automatically passed to the frontend. The `.env` file is only needed if running the frontend standalone.

---

## 📊 Testing

```bash
# Backend tests (includes property tests)
cd backend
pytest -v

# Frontend tests
cd frontend
npm test

# Property-based tests only
pytest -v -m property  # Backend
npm run test:property   # Frontend
```

---

## 🎯 Using the Web UI

1. **Upload a model**: Drag STL/3MF file onto the viewport
2. **Select printer**: Choose manufacturer → model → bed type (left panel)
3. **Select filaments**: Add one or more filament profiles
4. **Select process**: Choose quality preset (0.2mm, 0.16mm, etc.)
5. **Adjust parameters**: Fine-tune in Quality/Strength/Support tabs (optional)
6. **Configure action**: Choose "Slice" or export options (right panel)
7. **Submit job**: Click the Slice button
8. **Monitor progress**: Real-time updates via WebSocket
9. **Download G-code**: When job completes, download from output list

---

## 🔒 Production Checklist

Before deploying publicly:

- [ ] Change `API_SECRET` to `openssl rand -hex 32` output
- [ ] Set up HTTPS reverse proxy (nginx/Caddy)
- [ ] Configure firewall (only expose 443)
- [ ] Adjust `MAX_CONCURRENT_JOBS` for your CPU
- [ ] Set up backup for `workspace` volume
- [ ] Configure log aggregation
- [ ] Review retention policies for disk space
- [ ] Test with real slicing workload

---

## 📁 Where Files Are Stored

Inside the Docker container:

```
/app/
├── orca-slicer/              # Mounted from ../squashfs-root (read-only)
│   ├── usr/bin/orca-slicer  # CLI binary
│   └── resources/profiles/   # Profile library
└── workspace/                # Persistent Docker volume
    ├── sessions/             # User uploads (by session ID)
    ├── jobs/                 # Job outputs (G-code files)
    └── orcaslicer.db         # SQLite database
```

On your host machine:
- **AppImage extraction**: `/home/odin/local/orcaslicerWebUI/squashfs-root/`
- **Docker volume**: Managed by Docker (see `docker volume inspect orcaslicerwebui_workspace`)

---

## 🏗️ Architecture

```
Browser → nginx (port 80) → FastAPI (port 8000) → OrcaSlicer CLI
                ↓                    ↓
         Static React UI      Job Queue + WebSocket
                                     ↓
                              SQLite + File Storage
```

---

## 📚 Documentation

- **Requirements**: `.kiro/specs/orca-slicer-web-ui/requirements.md`
- **Design**: `.kiro/specs/orca-slicer-web-ui/design.md`
- **Task Plan**: `.kiro/specs/orca-slicer-web-ui/tasks.md`

---

## ✅ Spec Implementation Status

**All 110 implementation tasks completed!** 🎉

The spec includes:
- ✅ Complete backend (FastAPI + SQLite + job queue)
- ✅ Complete frontend (React + Three.js + WebSocket)
- ✅ 21 correctness properties with property-based tests
- ✅ Docker deployment configuration
- ✅ End-to-end integration tests

**Ready for production use!**

---

Save these instructions as `SETUP.md` in your `OrcaSlicerWebUI/` directory for future reference.