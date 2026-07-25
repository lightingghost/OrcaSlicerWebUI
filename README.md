# OrcaSlicer Web UI

A web-based interface for [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer), enabling browser-based 3D model slicing with real-time preview and job management.

## ✨ Features

- 🌐 **Web-based**: Access from any device on your network
- 🎨 **3D Preview**: Real-time model visualization with Three.js
- ⚡ **Fast Slicing**: Leverages native OrcaSlicer CLI for speed
- 🔄 **Real-time Updates**: WebSocket-based progress tracking
- 📦 **Profile Library**: Full access to OrcaSlicer's manufacturer profiles (Bambu Lab, Prusa, Voron, etc.)
- 🎛️ **Parameter Control**: Fine-tune 800+ slicing parameters via web UI
- 🚀 **Job Queue**: Concurrent slicing with configurable limits
- 🐳 **Docker Deploy**: Single-container image with frontend + backend + OrcaSlicer CLI

## 🚀 Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd OrcaSlicerWebUI

# Configure the OrcaSlicer version to use (optional, defaults to 2.4.2/x86_64)
# Edit build.env if you want a different version or architecture
cat build.env
# ORCASLICER_VERSION=2.4.2
# ARCH=x86_64

# Build and start (first time: ~5-10 minutes)
docker compose --env-file build.env build
docker compose --env-file build.env up -d

# Access the UI
open http://localhost
```

**That's it!** The container includes:
- React frontend (nginx on port 80)
- FastAPI backend (uvicorn on localhost:8000)
- OrcaSlicer CLI (extracted from official AppImage)
- All manufacturer profiles (Bambu Lab, Prusa, Voron, etc.)

## 📖 Documentation

- **[SETUP.md](SETUP.md)**: Detailed setup guide (Docker + local development)
- **[build.env](build.env)**: Build-time configuration (version/arch pinning)
- **.env** (create this): Runtime configuration (API secret, optional)

## 🔒 Security

The default API secret is `changeme` (insecure). For production, create a `.env` file:

```bash
echo "API_SECRET=$(openssl rand -hex 32)" > .env
```

Then rebuild and restart:

```bash
docker compose --env-file build.env build
docker compose --env-file build.env up -d
```

## 🏗️ Architecture

```
Browser → nginx → FastAPI → OrcaSlicer CLI
              ↓         ↓
       React SPA   Job Queue + WebSocket
                        ↓
                SQLite + File Storage
```

**Tech Stack:**
- **Frontend**: React 18 + TypeScript + Three.js + Zustand
- **Backend**: Python 3.11 + FastAPI + SQLAlchemy + asyncio
- **Runtime**: nginx + uvicorn (single container)
- **Slicing**: OrcaSlicer 2.4.2 CLI (headless)

## 📦 What Gets Downloaded at Build Time

The Dockerfile automatically:
1. Downloads OrcaSlicer source (shallow git clone at pinned version)
2. Generates parameter JSON files from source
3. Deletes the source (never in final image)
4. Downloads OrcaSlicer AppImage (from GitHub releases)
5. Extracts the AppImage to get CLI + profiles
6. Bakes everything into a single ~1.8GB image

**No manual AppImage download required!** Just edit `build.env` to change versions.

## 🚢 Deployment

### Local / Self-Hosted

See [SETUP.md](SETUP.md) for Docker Compose deployment with HTTPS reverse proxy.

### GitHub Container Registry (CI/CD)

On every push to `main`, GitHub Actions:
1. Reads `build.env` for version/arch
2. Builds the image
3. Publishes to `ghcr.io/<your-username>/orcaslicerwebui:<version>`

Pull and run a published image:

```bash
docker pull ghcr.io/<your-username>/orcaslicerwebui:2.4.2
echo "API_SECRET=$(openssl rand -hex 32)" > .env

docker run -d \
  -p 80:80 \
  -v orcaslicer-workspace:/app/workspace \
  -e API_SECRET=$(cat .env | cut -d= -f2) \
  ghcr.io/<your-username>/orcaslicerwebui:2.4.2
```

## 🔧 Development

For local development without Docker:

```bash
# Backend
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
export ORCA_CLI_PATH=/path/to/squashfs-root/usr/bin/orca-slicer
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
echo "VITE_API_SECRET=dev-secret" > .env
npm run dev
```

**Or use the quickstart script:**

```bash
./run-local.sh
```

## 🧪 Testing

```bash
# Backend tests
cd backend
pytest -v

# Frontend tests
cd frontend
npm test
```

## 📝 License

See [LICENSE](LICENSE) for details.

## 🙏 Credits

Built on top of [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) by SoftFever and contributors.
