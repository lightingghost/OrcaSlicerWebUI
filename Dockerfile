# syntax=docker/dockerfile:1
#
# Combined frontend + backend image for OrcaSlicer Web UI.
# uvicorn (FastAPI) serves both the API and the React SPA — no nginx needed.
#
# Build args (normally sourced from build.env):
#   ORCASLICER_VERSION  e.g. 2.4.2  (tag WITHOUT leading "v")
#   VITE_API_SECRET     shared secret baked into the frontend bundle
#
# Architecture is intentionally NOT a manual build-arg. This single
# Dockerfile builds for whichever platform Buildx is targeting via the
# automatic TARGETARCH build-arg (see stage 3 below) — Docker sets this
# to "amd64" or "arm64" per the `--platform`/`platforms:` value the
# builder is invoked with, whether that's a plain local `docker build`
# (defaults to the host's arch), or a CI matrix building each platform
# natively on its own runner (see .github/workflows/docker-build.yml).
# There's no need for separate per-arch Dockerfiles: every base image
# used below (alpine/git, python:3.11-slim, node:18, ubuntu:24.04) ships
# both amd64 and arm64 variants, and OrcaSlicer itself publishes an
# aarch64 AppImage release alongside the x86_64 one.
#
# Stages:
#   1. orca-source   - shallow-clone OrcaSlicer source at the pinned tag
#   2. json-gen      - generate 3 JSON artifacts from source, then discard source
#   3. orca-appimage - download + extract AppImage, strip to only what's needed:
#                       bin/orca-slicer + resources/profiles/
#   4. frontend-build - npm ci + vite build
#   5. backend-deps  - Python venv with all runtime deps
#   6. runtime       - ubuntu:24.04 + OrcaSlicer CLI runtime libs + app

ARG ORCASLICER_VERSION=2.4.2

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
COPY scripts/parameter_parser.py ./parameter_parser.py
COPY scripts/extract_printer_config_options.py ./extract_printer_config_options.py
COPY scripts/extract_filament_config_options.py ./extract_filament_config_options.py
COPY docker/generate_parameters.py ./generate_parameters.py

RUN mkdir -p /gen/out/data && \
    python3 generate_parameters.py /gen/OrcaSlicer /gen/out/data/parameters.json && \
    python3 extract_printer_config_options.py \
      --orca-root /gen/OrcaSlicer \
      --out /gen/out/data/printer_config_dialog_options.json && \
    python3 extract_filament_config_options.py \
      --orca-root /gen/OrcaSlicer \
      --out /gen/out/data/filament_config_dialog_options.json && \
    rm -rf /gen/OrcaSlicer
# The OrcaSlicer source tree is deleted above and never copied to a later stage.

# ---------------------------------------------------------------------------
# Stage 3: download + extract AppImage, keep only what's needed at runtime
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS orca-appimage
ARG ORCASLICER_VERSION
# TARGETARCH is populated automatically by Buildx ("amd64" or "arm64") to
# match whichever platform this stage is being built for — no manual
# build-arg needed. Mapped below to OrcaSlicer's own AppImage asset
# naming convention (x86_64 / aarch64), which differs from Docker's.
ARG TARGETARCH
RUN apt-get update && \
    apt-get install --no-install-recommends -y ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /appimage
RUN case "${TARGETARCH}" in \
      amd64) ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCASLICER_VERSION}.AppImage" ;; \
      arm64) ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCASLICER_VERSION}.AppImage" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCASLICER_VERSION}/${ASSET}" && \
    echo "Downloading ${URL}" && \
    curl -fL --retry 3 -o orca.AppImage "${URL}" && \
    chmod +x orca.AppImage && \
    ./orca.AppImage --appimage-extract && \
    rm -f orca.AppImage && \
    # -----------------------------------------------------------------------
    # Strip everything from squashfs-root that isn't needed for headless CLI
    # slicing.  Only two things are required:
    #   bin/orca-slicer          – the CLI binary
    #   resources/profiles/      – manufacturer printer/filament/process JSONs
    # Removed (~170 MB):
    #   resources/hms/           – Bambu Cloud error codes
    #   resources/images/        – GUI textures
    #   resources/fonts/         – GUI fonts
    #   resources/web/           – embedded Bambu browser UI
    #   resources/i18n/          – localization strings
    #   resources/handy_models/  – example 3MF models
    #   resources/calib/         – calibration test prints
    #   resources/tooltip/       – GUI tooltip images
    #   resources/Icon.icns      – macOS icon
    # -----------------------------------------------------------------------
    rm -rf \
      squashfs-root/resources/hms \
      squashfs-root/resources/images \
      squashfs-root/resources/fonts \
      squashfs-root/resources/web \
      squashfs-root/resources/i18n \
      squashfs-root/resources/handy_models \
      squashfs-root/resources/calib \
      squashfs-root/resources/tooltip \
      squashfs-root/resources/Icon.icns \
      squashfs-root/share \
      squashfs-root/OrcaSlicer.png \
      squashfs-root/com.orcaslicer.OrcaSlicer.desktop

# ---------------------------------------------------------------------------
# Stage 4: frontend build
#
# Layer order is chosen so that editing frontend SOURCE (src/, public/) never
# invalidates the `npm ci` layer — only package.json/package-lock.json
# changes do. `npm ci` also uses a persistent BuildKit cache mount so a
# cache-miss on this layer (e.g. lockfile bump) doesn't re-download every
# package from the registry.
# ---------------------------------------------------------------------------
FROM node:18 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ .
# Inject the generated JSON files so Vite copies them into dist/data/
COPY --from=json-gen /gen/out/data/printer_config_dialog_options.json ./public/data/
COPY --from=json-gen /gen/out/data/filament_config_dialog_options.json ./public/data/

ARG VITE_API_SECRET=changeme
ENV VITE_API_SECRET=${VITE_API_SECRET}
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 5: backend Python dependencies (isolated venv, built on ubuntu:24.04
# so the Python version matches the runtime stage exactly)
#
# Only pyproject.toml is copied here (not app/ source) so editing backend
# code never invalidates this stage — only a dependency change does. pip
# uses a persistent BuildKit cache mount so re-resolving deps after a
# lockfile-equivalent change doesn't re-download every wheel.
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS backend-deps
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && \
    apt-get install --no-install-recommends -y python3 python3-venv python3-pip gcc
WORKDIR /build
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY backend/pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install .

# ---------------------------------------------------------------------------
# Stage 6: runtime image — single process (uvicorn), no nginx
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && \
    apt-get install --no-install-recommends -y \
      python3 \
      python3-venv \
      ca-certificates \
      # OrcaSlicer CLI runtime deps (verified with ldd on Ubuntu 24.04)
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
    && \
    # Strip runtime-irrelevant share data to reduce image size (~70 MB)
    rm -rf \
      /usr/share/doc \
      /usr/share/man \
      /usr/share/info \
      /usr/share/icons \
      /usr/share/sounds \
      /usr/share/locale \
      /usr/share/hunspell \
      /usr/share/aspell \
      /usr/share/directfb-1.7.7 \
      /usr/lib/systemd

# Layers below are ordered from least- to most-frequently-changed so that
# `docker build` during day-to-day frontend/backend edits only has to redo
# the last one or two (cheap) layers instead of re-copying the ~200MB
# squashfs-root or re-resolving the venv. squashfs-root/parameters.json only
# change when ORCASLICER_VERSION/ARCH are bumped in build.env; backend/app
# and the frontend dist change on every code edit.

# --- Python venv (changes only when backend deps change) ---
COPY --from=backend-deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# --- OrcaSlicer CLI (changes only when ORCASLICER_VERSION/ARCH change) ---
COPY --from=orca-appimage /appimage/squashfs-root /app/squashfs-root

# --- Generated parameters.json (changes only when ORCASLICER_VERSION changes) ---
# loaded by backend at /app/data/parameters.json
# (repo_root = /app, resolved via Path(__file__).parent * 3 in parameters.py)
COPY --from=json-gen /gen/out/data/parameters.json /app/data/parameters.json

# --- Backend migrations (changes rarely) ---
WORKDIR /app/backend
COPY backend/migrations/ ./migrations/

# --- Backend app source (changes on every backend edit) ---
COPY backend/app/ ./app/

# --- Frontend static assets (changes on every frontend edit) ---
COPY --from=frontend-build /app/dist /app/frontend/dist

ENV ORCA_CLI_PATH=/app/squashfs-root/bin/orca-slicer \
    WORKSPACE_ROOT=/app/workspace \
    TMP_ROOT=/app/tmp \
    USER_WORKSPACE=/app/workspace/user_configs \
    STATIC_DIR=/app/frontend/dist \
    MAX_CONCURRENT_JOBS=4 \
    JOB_TIMEOUT_SECONDS=3600 \
    OUTPUT_RETENTION_SECONDS=86400 \
    JOB_RECORD_RETENTION_SECONDS=604800 \
    API_SECRET=changeme

# /app/workspace holds PERSISTENT data (user configs/autosaves/custom
# profiles) — back it with a durable Docker volume.
# /app/tmp holds EPHEMERAL data (session uploads, job outputs, sqlite db)
# — safe to back with tmpfs (see docker-compose.yml).
RUN mkdir -p /app/workspace /app/tmp

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
