#!/usr/bin/env bash
set -euo pipefail

# Docker-based Chroma server launcher for Jetson

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults (overridable via env or flags)
HOST="${CHROMA_HOST:-0.0.0.0}"
PORT="${CHROMA_PORT:-8000}"
DATA_DIR="${CHROMA_DATA_DIR:-/home/jetson/playa-ai/chroma/data}"
CONTAINER_NAME="${CHROMA_CONTAINER:-chroma_server_playa}"
IMAGE_TAG="${CHROMA_IMAGE:-ghcr.io/chroma-core/chroma:0.5.5}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--host 0.0.0.0] [--port 8000] [--data /path/to/data] [--name container_name] [--image repo:tag]

Environment overrides:
  CHROMA_HOST, CHROMA_PORT, CHROMA_DATA_DIR, CHROMA_CONTAINER, CHROMA_IMAGE

Examples:
  $(basename "$0") --port 8001
  CHROMA_DATA_DIR=/mnt/chroma $(basename "$0")
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --data) DATA_DIR="$2"; shift 2 ;;
    --name) CONTAINER_NAME="$2"; shift 2 ;;
    --image) IMAGE_TAG="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

# Stop existing container if present
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting Chroma (Docker) on ${HOST}:${PORT} with data dir ${DATA_DIR}" >&2
docker run \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -v "$DATA_DIR":/data \
  -p "$PORT":8000 \
  -e CHROMA_SERVER_HOST=0.0.0.0 \
  -e CHROMA_SERVER_HTTP_PORT=8000 \
  "$IMAGE_TAG" >/dev/null 2>&1 &

# Health check
for i in {1..60}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1/heartbeat" >/dev/null; then
    echo "Chroma is up (container: ${CONTAINER_NAME})" >&2
    exit 0
  fi
  sleep 1
done

echo "Chroma failed to start. Check: docker logs ${CONTAINER_NAME}" >&2
exit 1

