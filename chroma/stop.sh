#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CHROMA_CONTAINER:-chroma_server_playa}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
  echo "Stopped Chroma container ($CONTAINER_NAME)" >&2
else
  echo "Chroma container not found" >&2
fi

