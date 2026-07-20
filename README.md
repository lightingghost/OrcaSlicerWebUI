# OrcaSlicer Web UI

A browser-based front-end for the OrcaSlicer CLI, enabling users to upload 3D models, configure slicing parameters, and monitor slicing jobs in real-time—all from a web browser.

## Architecture

- **Backend**: FastAPI Python server that wraps the OrcaSlicer CLI
- **Frontend**: React 18 + TypeScript SPA with Three.js 3D viewport
- **Deployment**: Docker Compose with nginx reverse proxy

## Features

### Core Functionality
- 3D model file upload (STL, 3MF, OBJ, AMF)
- Interactive 3D viewport with Three.js
- Profile management (printer, process, filament)
- Full parameter configuration
- Real-time progress monitoring via WebSocket
- Job queue and execution management
- Output file download
- Job history

### Security
- Path traversal protection
- Parameter allowlist validation
- Schema validation with Pydantic v2
- Authentication via Bearer token
- No shell interpolation (subprocess list args)

### Quality Assurance
- Property-based testing (Hypothesis + fast-check)
- Unit tests for all components
- Integration tests for end-to-end flows
- 21 correctness properties verified

## Project Structure

```
OrcaSlicerWebUI/
├── backend/
│   ├── app/              # FastAPI application
│   ├── migrations/       # Database migrations
│   ├── tests/            # Backend tests
│   ├── pyproject.toml    # Python dependencies
│   └── README.md
├── frontend/
│   ├── src/              # React application source
│   ├── public/           # Static assets
│   ├── package.json      # npm dependencies
│   └── README.md
└── docker-compose.yml    # Docker orchestration
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OrcaSlicer CLI binary

### Run with Docker Compose

```bash
docker-compose up
```

Access the UI at `http://localhost:80`

### Development

#### Backend

```bash
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Configuration

Environment variables for the backend (see `docker-compose.yml`):

- `ORCA_CLI_PATH`: Path to OrcaSlicer CLI binary
- `WORKSPACE_ROOT`: File storage root directory
- `MAX_CONCURRENT_JOBS`: Concurrent job limit (default: 4)
- `JOB_TIMEOUT_SECONDS`: Job timeout (default: 3600)
- `OUTPUT_RETENTION_SECONDS`: Output file retention (default: 86400)
- `JOB_RECORD_RETENTION_SECONDS`: Job record retention (default: 604800)
- `API_SECRET`: Authentication secret

## Testing

### Backend
```bash
cd backend
pytest
```

### Frontend
```bash
cd frontend
npm test
```

## Documentation

- [Requirements](/.kiro/specs/orca-slicer-web-ui/requirements.md)
- [Design](/.kiro/specs/orca-slicer-web-ui/design.md)
- [Task Plan](/.kiro/specs/orca-slicer-web-ui/tasks.md)

## License

See parent OrcaSlicer project for license information.
