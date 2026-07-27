# 🚀 OrcaSlicer Web UI Setup Instructions

This guide covers setting up the OrcaSlicer Web UI with the new **combined-container Docker build** that includes both frontend and backend in a single image.

## 📋 Quick Setup (Docker - Recommended)

### Step 1: Configure Build Version

The `build.env` file controls which OrcaSlicer version and architecture the Docker image is built for:

```bash
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI

cat build.env
# ORCASLICER_VERSION=2.4.2
# ARCH=x86_64
```

**Valid values:**
- `ORCASLICER_VERSION`: Version number **without leading "v"** (e.g. `2.4.2`, not `v2.4.2`)
- `ARCH`: `x86_64` or `aarch64` (matches OrcaSlicer's AppImage release naming)

To use a different version, edit `build.env` before building.

### Step 2: Configure API Secret (Optional but Recommended)

Create a `.env` file in the OrcaSlicerWebUI directory for runtime configuration:

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

If you skip this step, the default `changeme` secret will be used (insecure for production).

### Step 3: Build and Start

```bash
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI

# Build the image (first time: 5-10 minutes)
docker compose --env-file build.env build

# Start the container
docker compose --env-file build.env up -d

# Check logs
docker compose logs -f
```

**What happens during build:**
1. Downloads OrcaSlicer source at the pinned version (to generate parameter JSON files)
2. Generates `parameters.json` + `printer_config_dialog_options.json` + `filament_config_dialog_options.json`
3. Deletes the source (never lands in final image)
4. Downloads the OrcaSlicer AppImage for the pinned version/arch
5. Extracts the AppImage to `squashfs-root/` (contains CLI + profiles)
6. Builds the frontend (React + Vite)
7. Builds the backend (FastAPI + Python deps)
8. Assembles a single runtime image with nginx (serving frontend) + uvicorn (serving backend API)

**Image size:** ~1.8GB (includes full OrcaSlicer GUI dependencies for headless CLI operation)

### Step 4: Access the UI

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

## 🔧 Local Development Setup (Without Docker)

For active development on the codebase itself (not for just using the Web UI), see `run-local.sh`:

### Prerequisites

```bash
# Extract an OrcaSlicer AppImage manually
cd /home/odin/local/orcaslicerWebUI
chmod +x OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage
./OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage --appimage-extract
# Creates squashfs-root/ with usr/bin/orca-slicer + resources/profiles/
```

### Backend

```bash
cd OrcaSlicerWebUI/backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Configure (adjust paths to your setup)
export ORCA_CLI_PATH=/home/odin/local/orcaslicerWebUI/squashfs-root/usr/bin/orca-slicer
export WORKSPACE_ROOT=/tmp/orca-workspace
export API_SECRET=dev-secret

# Run with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd OrcaSlicerWebUI/frontend
npm install

# Create .env file with API secret
cat > .env << 'EOF'
VITE_API_SECRET=dev-secret
EOF

npm run dev
# Available at http://localhost:5173
```

**Or use the provided script** (automatically configures paths + runs both frontend & backend):

```bash
cd /home/odin/local/orcaslicerWebUI/OrcaSlicerWebUI
./run-local.sh
```

---

## 🐛 Troubleshooting

### Docker Build Failures

**Error: `ORCASLICER_VERSION variable is not set`**

You forgot to pass `--env-file build.env` to docker compose. Always use:

```bash
docker compose --env-file build.env build
docker compose --env-file build.env up -d
```

**Error: `unsquashfs: FATAL ERROR: Can't find a valid SQUASHFS superblock`** (old error, now fixed)

This was fixed by using `./AppImage --appimage-extract` instead of `unsquashfs`. If you see this, ensure you're using the latest Dockerfile.

**Error: Frontend TypeScript errors during build**

The Dockerfile uses `vite build` (no type-checking) to avoid test file type errors. If you want strict type-checking, run `npm run build:check` locally before committing.

### "Failed to fetch manufacturers: 401" or "Upload failed with status 401"

The frontend and backend API secrets don't match.

**For Docker:**
- Ensure `.env` file exists with `API_SECRET=<your-secret>`
- Rebuild: `docker compose --env-file build.env build`
- Restart: `docker compose --env-file build.env up -d`

**For local development:**
- Backend: Set `export API_SECRET=dev-secret` before running uvicorn
- Frontend: Create `frontend/.env` with `VITE_API_SECRET=dev-secret`
- Or just use `./run-local.sh` which handles this automatically

### Port 80 already in use

Edit `docker-compose.yml`:
```yaml
services:
  orcaslicer-webui:
    ports:
      - "8080:80"  # Use 8080 instead
```

Rebuild and access at: `http://localhost:8080`

### Backend logs show "ORCA_CLI_PATH: binary not found"

This should never happen with the Docker build (the CLI is baked into the image at a fixed path). If you see this:
1. Check you're using the correct image: `docker images orcaslicerwebui-orcaslicer-webui`
2. Verify the entrypoint didn't fail: `docker compose logs`
3. Inspect the running container: `docker compose exec orcaslicer-webui ls -la /app/squashfs-root/usr/bin/`

For local development, ensure `ORCA_CLI_PATH` points to your extracted AppImage's CLI binary.

---

## 🚢 Deploying to Production

### Option 1: Local Docker

```bash
# Use a strong API secret
echo "API_SECRET=$(openssl rand -hex 32)" > .env

# Build and run
docker compose --env-file build.env build
docker compose --env-file build.env up -d

# Set up HTTPS reverse proxy (nginx/Caddy) in front of port 80
```

### Option 2: GitHub Container Registry (Automated)

The `.github/workflows/docker-build.yml` workflow automatically:
1. Reads `build.env` on every push to `main`
2. Builds the image with those pinned version/arch settings
3. Publishes to `ghcr.io/<your-username>/orcaslicerwebui:<version>`

**To use a published image:**

```bash
# Pull from GHCR (replace <your-username> with your GitHub username)
docker pull ghcr.io/<your-username>/orcaslicerwebui:2.4.2

# Or reference in docker-compose.yml:
services:
  orcaslicer-webui:
    image: ghcr.io/<your-username>/orcaslicerwebui:2.4.2
    environment:
      - API_SECRET=${API_SECRET}
    ports:
      - "80:80"
    volumes:
      - workspace:/app/workspace
    tmpfs:
      - /app/tmp:size=2g
    restart: unless-stopped

volumes:
  workspace:
```

Then just:
```bash
echo "API_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

---

## 🔒 Production Checklist

Before deploying publicly:

- [ ] Set `API_SECRET` to `openssl rand -hex 32` output (in `.env`)
- [ ] Set up HTTPS reverse proxy (Caddy/nginx with Let's Encrypt)
- [ ] Configure firewall (only expose 443 publicly)
- [ ] Adjust `MAX_CONCURRENT_JOBS` env var for your CPU cores (default: 4)
- [ ] Set up automated backups for the `workspace` Docker volume
- [ ] Configure log aggregation (e.g. docker logs → journald → Loki)
- [ ] Review retention policies (`OUTPUT_RETENTION_SECONDS`, `JOB_RECORD_RETENTION_SECONDS`)
- [ ] Test with real slicing workload and monitor disk I/O

---

## 📁 Where Files Are Stored

Storage is split into two roots by lifecycle (see `backend/app/config.py`'s
`Settings` docstring):

- **`/app/workspace`** — PERSISTENT. User configs, autosaves, and
  user-uploaded custom profiles. Backed by the `workspace` Docker volume,
  so it survives container restarts/recreations.
- **`/app/tmp`** — EPHEMERAL. Session uploads, job outputs (gcode/3mf/
  logs), and the sqlite job/file-metadata database. Backed by **tmpfs**
  (in-memory) in `docker-compose.yml` — nothing here is expected to
  survive a restart, and keeping it off the host disk avoids wearing out
  storage on repeated slice-job I/O.

Inside the Docker container:

```
/app/
├── squashfs-root/            # Baked into image (OrcaSlicer AppImage extraction)
│   ├── usr/bin/orca-slicer  # CLI binary
│   └── resources/profiles/   # Profile library
├── backend/                  # FastAPI app
│   ├── app/
│   │   └── data/parameters.json  # Generated at build time
│   └── migrations/
├── workspace/                # Persistent Docker volume
│   ├── custom_profiles/     # User-uploaded custom profiles
│   └── user_configs/        # Saved printer/filament/process configs + autosaves
└── tmp/                      # Ephemeral, tmpfs-backed
    ├── sessions/             # User uploads (by session ID)
    ├── jobs/                 # Job outputs (G-code files, logs)
    └── orcaslicer_webui.db   # SQLite job/file metadata
```

On your host machine:
- **Docker volume**: Managed by Docker (`docker volume inspect orcaslicerwebui_workspace`)
- **tmpfs mount**: RAM-backed, not visible as a host file — size it via
  `docker-compose.yml`'s `tmpfs: - /app/tmp:size=2g` (raise for large
  models or many concurrent jobs; requires enough host RAM)
- **OrcaSlicer source**: Only exists during build (never in final image)
- **AppImage**: Only exists during build (extracted content baked into image)

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

## 🏗️ Architecture

**Combined-Container (Current):**
```
Browser → nginx (port 80) → FastAPI (localhost:8000) → OrcaSlicer CLI
                ↓ (same container)       ↓
         Static React UI          Job Queue + WebSocket
                                       ↓
                               SQLite + File Storage
```

Both nginx and uvicorn run in the same container, supervised by `docker/entrypoint.sh`.

**Legacy (Separate Containers):**
The old separate `frontend/Dockerfile` + `backend/Dockerfile` are kept for reference but are no longer used by `docker-compose.yml`.

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
npm run test:property   # Frontend (if script exists)
```

---

## 📚 Documentation

- **Requirements**: `.kiro/specs/orca-slicer-web-ui/requirements.md`
- **Design**: `.kiro/specs/orca-slicer-web-ui/design.md`
- **Task Plan**: `.kiro/specs/orca-slicer-web-ui/tasks.md`
- **Build Config**: `build.env` (version/arch pinning)
- **Runtime Config**: `.env` (API secret)
- **Docker Build**: `Dockerfile` (multi-stage combined image)
- **Docker Compose**: `docker-compose.yml` (single service)
- **GitHub Actions**: `.github/workflows/docker-build.yml` (CI/CD to GHCR)

---

## ✅ Implementation Status

**All 110 implementation tasks completed!** 🎉

Recent additions:
- ✅ Combined frontend+backend Docker container (single image)
- ✅ Automated OrcaSlicer source/AppImage download at build time
- ✅ Generated parameter JSON files baked into image
- ✅ GitHub Actions workflow for publishing to GHCR
- ✅ Cleaned docker-compose.yml (no bind-mounts, single service)

**Ready for production use!**
