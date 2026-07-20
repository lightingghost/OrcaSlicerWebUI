# Backend Dockerfile for OrcaSlicer Web UI
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (if needed for Python packages)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml first for dependency installation
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Copy application code
COPY app/ ./app/
COPY migrations/ ./migrations/

# Create workspace directory for runtime file operations
RUN mkdir -p /app/workspace

# Expose port 8000 for FastAPI
EXPOSE 8000

# Run uvicorn server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
