# syntax=docker/dockerfile:1
#
# Combined frontend + backend image for OrcaSlicer Web UI.
#
# Build args (normally sourced from build.env):
#   ORCASLICER_VERSION  e.g. 2.4.2  (tag WITHOUT leading "v")
#   ARCH                x86_64 | aarch64
#   VITE_API_SECRET     shared secret baked into the frontend bundle (must
#                        match the backend's API_SECRET at runtime)
#
# Stages:
#   1. orca-source   - shallow-clone OrcaSlicer at the pinned tag (source
#                       only, used to regenerate parameter/config JSON)
#   2. json-gen      - runs parameter_parser.py + scripts/extract_*.py
#                       against orca-source, produces the 3 JSON artifacts,
#                       then the orca-source checkout is discarded (it is
#                       never copied into any later stage)
#   3. orca-appimage - downloads the AppImage release asset for
#                       ORCASLICER_VERSION/ARCH and extracts it with
#                       unsquashfs (no FUSE/--appimage-extract needed)
#   4. frontend-build - npm ci + vite build; consumes the frontend JSON
#                       artifacts from json-gen before `npm run build` so
#                       Vite copies them into dist/data/
#   5. backend-deps  - installs the Python package (incl. deps) into a
#                       venv, kept separate from the runtime stage's apt
#                       layer for cache efficiency
#   6. runtime       - ubuntu:24.04 + nginx + python3 + the artifacts from
#                       every stage above + entrypoint.sh

ARG ORCASLICER_VERSION=2.4.2
ARG ARCH=x86_64

# ---------------------------------------------------------------------------
# Stage 1: fetch OrcaSlicer source at the pinned tag (shallow clone)
# ---------------------------------------------------------------------------
FROM alpine/git:2.45.2 AS orca-source
ARG ORCASLICER_VERSION
WORKDIR /src
RUN git clone --depth 1 --branch "v${ORCASLICER_VERSION}" \
      https://github.com/OrcaSlicer/OrcaSlicer.git OrcaSlicer

# ---------------------------------------------------------------------------
# Stage 2: generate parameters.json / *_config_dialog_options.json
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS json-gen
WORKDIR /gen
COPY --from=orca-source /src/OrcaSlicer ./OrcaSlicer
COPY backend/app/parameter_parser.py ./parameter_parser.py
COPY scripts/extract_printer_config_options.py ./extract_printer_config_options.py
COPY scripts/extract_filament_config_options.py ./extract_filament_config_options.py
COPY docker/generate_parameters.py ./generate_parameters.py

RUN mkdir -p /gen/out/backend-data /gen/out/frontend-data && \
    python3 generate_parameters.py /gen/OrcaSlicer /gen/out/backend-data/parameters.json
RUN python3 extract_printer_config_options.py \
      --orca-root /gen/OrcaSlicer \
      --out /gen/out/frontend-data/printer_config_dialog_options.json && \
    python3 extract_filament_config_options.py \
      --orca-root /gen/OrcaSlicer \
      --out /gen/out/frontend-data/filament_config_dialog_options.json && \
    rm -rf /gen/OrcaSlicer
# NOTE: the OrcaSlicer source tree is removed above and is never COPY'd
# into any downstream stage, so it never lands in the final image.

# ---------------------------------------------------------------------------
# Stage 3: download + extract the OrcaSlicer AppImage
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS orca-appimage
ARG ORCASLICER_VERSION
ARG ARCH
RUN apt-get update && \
    apt-get install --no-install-recommends -y ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /appimage
RUN case "${ARCH}" in \
      x86_64)  ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCASLICER_VERSION}.AppImage" ;; \
      aarch64) ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCASLICER_VERSION}.AppImage" ;; \
      *) echo "Unsupported ARCH: ${ARCH} (expected x86_64 or aarch64)" >&2; exit 1 ;; \
    esac && \
    URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCASLICER_VERSION}/${ASSET}" && \
    echo "Downloading ${URL}" && \
    curl -fL --retry 3 -o orca.AppImage "${URL}" && \
    chmod +x orca.AppImage && \
    ./orca.AppImage --appimage-extract && \
    rm -f orca.AppImage

# ---------------------------------------------------------------------------
# Stage 4: frontend build
# ---------------------------------------------------------------------------
FROM node:18 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
COPY --from=json-gen /gen/out/frontend-data/. ./public/data/

ARG VITE_API_SECRET=changeme
ENV VITE_API_SECRET=${VITE_API_SECRET}
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 5: backend python dependencies (isolated venv)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS backend-deps
WORKDIR /build
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY backend/pyproject.toml ./
RUN apt-get update && \
    apt-get install --no-install-recommends -y gcc && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir . && \
    apt-get purge -y gcc && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Stage 6: runtime image (nginx + uvicorn, single container)
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install --no-install-recommends -y \
      nginx \
      python3 \
      python3-venv \
      ca-certificates \
      # --- OrcaSlicer CLI runtime deps (verified against the extracted
      #     AppImage binary's ldd output on Ubuntu 24.04) ---
      libwebkit2gtk-4.1-0 \
      libjavascriptcoregtk-4.1-0 \
      libmspack0 \
      libgtk-3-0t64 \
      libgl1 \
      libglu1-mesa \
      libegl1 \
      libsm6 \
      libice6 \
      gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good \
      gstreamer1.0-plugins-bad \
      gstreamer1.0-plugins-ugly \
      gstreamer1.0-gl \
      gstreamer1.0-gtk3 \
      libgstreamer-plugins-bad1.0-0 \
      libsecret-1-0 \
      libmanette-0.2-0 \
    && rm -rf /var/lib/apt/lists/*

# --- Backend ---
COPY --from=backend-deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
WORKDIR /app/backend
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY --from=json-gen /gen/out/backend-data/parameters.json ./app/data/parameters.json

# --- OrcaSlicer CLI (extracted AppImage) ---
COPY --from=orca-appimage /appimage/squashfs-root /app/squashfs-root

# --- Frontend static assets ---
RUN rm -f /etc/nginx/sites-enabled/default
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV ORCA_CLI_PATH=/app/squashfs-root/usr/bin/orca-slicer \
    WORKSPACE_ROOT=/app/workspace \
    USER_WORKSPACE=/app/workspace/user_configs \
    MAX_CONCURRENT_JOBS=4 \
    JOB_TIMEOUT_SECONDS=3600 \
    OUTPUT_RETENTION_SECONDS=86400 \
    JOB_RECORD_RETENTION_SECONDS=604800 \
    API_SECRET=changeme

RUN mkdir -p /app/workspace

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
