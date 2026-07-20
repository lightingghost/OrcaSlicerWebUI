# OrcaSlicer Web UI Backend

FastAPI backend that wraps the OrcaSlicer CLI binary.

## Features

- File upload management (STL, 3MF, OBJ, AMF)
- Profile management (printer, process, filament)
- Parameter configuration API
- Job submission and execution
- Real-time progress streaming via WebSocket
- Output file download
- Job history and retention management

## Requirements

- Python 3.11+
- OrcaSlicer CLI binary

## Installation

```bash
pip install -e ".[dev]"
```

## Running

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Environment Variables

- `ORCA_CLI_PATH`: Path to OrcaSlicer CLI binary
- `WORKSPACE_ROOT`: Root directory for file storage
- `MAX_CONCURRENT_JOBS`: Maximum concurrent jobs (default: 4)
- `JOB_TIMEOUT_SECONDS`: Job timeout in seconds (default: 3600)
- `OUTPUT_RETENTION_SECONDS`: Output file retention period (default: 86400)
- `JOB_RECORD_RETENTION_SECONDS`: Job record retention period (default: 604800)
- `API_SECRET`: API authentication secret

## Testing

```bash
pytest
```
