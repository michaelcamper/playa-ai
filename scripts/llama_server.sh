#!/usr/bin/env bash
set -euo pipefail

# Simple launcher for llama.cpp server on Jetson
# Defaults target the local build at /home/jetson/llama.cpp and models in /home/jetson/llama.cpp/models

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LLAMA_SERVER_BIN_DEFAULT="/home/jetson/llama.cpp/build/bin/llama-server"
MODELS_DIR_DEFAULT="/home/jetson/llama.cpp/models"

# Allow env overrides
HOST="${LLAMA_HOST:-0.0.0.0}"
PORT="${LLAMA_PORT:-8080}"
THREADS="${LLAMA_THREADS:-$(nproc)}"
CTX="${LLAMA_CTX:-2048}"
BATCH="${LLAMA_BATCH:-128}"
NGL="${LLAMA_NGL:-999}"
MODEL="${LLAMA_MODEL:-}"
BIN="${LLAMA_SERVER_BIN:-$LLAMA_SERVER_BIN_DEFAULT}"
DAEMON=false
JINJA="${LLAMA_JINJA:-true}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--model <name|/path/to/model.gguf>] [--host 0.0.0.0] [--port 8080]
                          [--threads N] [--ctx N] [--batch N] [--ngl N] [--bin /path/to/llama-server]
                          [--daemon]

Env overrides:
  LLAMA_MODEL, LLAMA_HOST, LLAMA_PORT, LLAMA_THREADS, LLAMA_CTX, LLAMA_BATCH, LLAMA_NGL, LLAMA_SERVER_BIN

Examples:
  $(basename "$0") --model llama3-8b-instruct    # resolves under ${MODELS_DIR_DEFAULT}
  $(basename "$0") --model Meta-Llama-3-8B-Instruct.Q4_K_M.gguf
  $(basename "$0") --model /home/jetson/llama.cpp/models/llama3/llama3.Q4_K_M.gguf
  LLAMA_MODEL=llama3-8b-instruct $(basename "$0") --port 8080
  $(basename "$0") --daemon --port 8080
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --model) MODEL="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    --ctx|--context) CTX="$2"; shift 2 ;;
    --batch) BATCH="$2"; shift 2 ;;
    --ngl) NGL="$2"; shift 2 ;;
    --bin) BIN="$2"; shift 2 ;;
    --daemon) DAEMON=true; shift 1 ;;
    --no-jinja) JINJA=false; shift 1 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

resolve_model() {
  local input="$1"
  local dir_default="${MODELS_DIR_DEFAULT}"

  # If input is empty: pick the first .gguf under default dir
  if [[ -z "$input" ]]; then
    find -L "$dir_default" -type f -iname "*.gguf" 2>/dev/null | head -n 1
    return
  fi

  # If input is an existing file path, use it
  if [[ -f "$input" ]]; then
    echo "$input"; return
  fi

  # If input is a directory, search within
  if [[ -d "$input" ]]; then
    find -L "$input" -type f -iname "*.gguf" 2>/dev/null | head -n 1
    return
  fi

  # If input ends with .gguf, try to find by exact filename anywhere under default dir
  if [[ "$input" == *.gguf ]]; then
    local match
    match=$(find -L "$dir_default" -type f -iname "${input}" 2>/dev/null | head -n 1 || true)
    if [[ -n "$match" ]]; then echo "$match"; return; fi
  fi

  # If a subdirectory exists with this name, search inside it
  if [[ -d "${dir_default}/${input}" ]]; then
    find -L "${dir_default}/${input}" -type f -iname "*.gguf" 2>/dev/null | head -n 1
    return
  fi

  # Try preferred quantizations by pattern under default dir
  local pat
  for pat in \
    "*${input}*Q5_K_M*.gguf" \
    "*${input}*Q4_K_M*.gguf" \
    "*${input}*Q8_0*.gguf" \
    "*${input}*Q5_0*.gguf" \
    "*${input}*Q4_0*.gguf" \
    "*${input}*.gguf"; do
    local found
    found=$(find -L "$dir_default" -type f -iname "$pat" 2>/dev/null | head -n 1 || true)
    if [[ -n "$found" ]]; then echo "$found"; return; fi
  done

  # Nothing found
  echo ""; return
}

# Resolve model path
MODEL_RESOLVED="$(resolve_model "${MODEL}")"

if [[ -z "${MODEL_RESOLVED}" ]]; then
  echo "Error: could not resolve model from input '${MODEL:-<none>}' under ${MODELS_DIR_DEFAULT}." >&2
  echo "       Pass a model name (e.g., 'llama3-8b-instruct'), a filename (e.g., '*.gguf'), or a full path." >&2
  exit 1
fi

MODEL="${MODEL_RESOLVED}"

if [[ ! -x "${BIN}" ]]; then
  echo "Error: llama-server binary not found or not executable: ${BIN}" >&2
  echo "       Build it via CMake or set --bin /path/to/llama-server" >&2
  exit 1
fi

# Ensure CUDA/ggml libs are discoverable (libggml-cuda.so lives next to the binary)
BIN_DIR="$(dirname "${BIN}")"
export LD_LIBRARY_PATH="${BIN_DIR}:${LD_LIBRARY_PATH:-}"

CMD=("${BIN}" \
  -m "${MODEL}" \
  -t "${THREADS}" \
  -c "${CTX}" \
  -b "${BATCH}" \
  -ngl "${NGL}" \
  --host "${HOST}" \
  --port "${PORT}")

if [[ "${JINJA}" == true ]]; then
  CMD+=(--jinja)
fi

echo "Launching llama-server:" >&2
printf '  %q ' "${CMD[@]}" >&2; echo >&2

LOG_DIR="/home/jetson/playa-ai/logs"
mkdir -p "${LOG_DIR}"

if [[ "${DAEMON}" == true ]]; then
  nohup "${CMD[@]}" > "${LOG_DIR}/llama-server.out" 2>&1 &
  pid=$!
  echo "llama-server started in background (pid ${pid}) on ${HOST}:${PORT}" >&2
  echo "Logs: ${LOG_DIR}/llama-server.out" >&2
else
  exec "${CMD[@]}"
fi

