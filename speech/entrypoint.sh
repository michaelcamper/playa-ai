#!/bin/bash
# Optimized entrypoint for speech server with DeepSpeed configuration

# Ensure libaio is findable
export LD_LIBRARY_PATH="/usr/lib/aarch64-linux-gnu:/usr/lib:${LD_LIBRARY_PATH}"

# DeepSpeed build configuration
export DS_BUILD_AIO=1
export DS_BUILD_SPARSE_ATTN=0
export DS_BUILD_CUTLASS=1
export CUTLASS_PATH=/opt/cutlass
export CFLAGS="-I/usr/include -I/usr/include/aarch64-linux-gnu"
export LDFLAGS="-L/usr/lib/aarch64-linux-gnu -L/usr/lib"
export TORCH_CUDA_ARCH_LIST="8.7"
export MAX_JOBS=4
export TORCH_NVCC_FLAGS="-w"
export CXXFLAGS="-Wno-narrowing -w"
export DEEPSPEED_BUILD_VERBOSE=0

# Suppress warnings we can't fix
export DS_SKIP_CUDA_CHECK=1
export PYTHONWARNINGS="ignore::UserWarning:deepspeed,ignore::UserWarning:torch"

# Audio optimizations
export PULSE_LATENCY_MSEC=60
export SDL_AUDIODRIVER=alsa

# Cache directories (use /tmp which is always writable)
export HOME="${HOME:-/workspace/speech}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/workspace/speech/.cache}"
export TORCH_EXTENSIONS_DIR="${TORCH_EXTENSIONS_DIR:-/workspace/speech/.cache/torch_extensions_ds}"
export NUMBA_CACHE_DIR="${NUMBA_CACHE_DIR:-/workspace/speech/.cache/numba}"
# Disable numba caching to avoid locator errors from librosa
export NUMBA_DISABLE_CACHING=1
mkdir -p "$TORCH_EXTENSIONS_DIR" "$NUMBA_CACHE_DIR"

# Matplotlib writable cache to avoid warnings during any import
export MPLCONFIGDIR="${XDG_CACHE_HOME}/matplotlib"
mkdir -p "$MPLCONFIGDIR"

# echo "[speech] Starting with optimized DeepSpeed configuration..."
# echo "[speech] CUTLASS_PATH: $CUTLASS_PATH"
# echo "[speech] LD_LIBRARY_PATH: $LD_LIBRARY_PATH"
# echo "[speech] TORCH_EXTENSIONS_DIR: $TORCH_EXTENSIONS_DIR"
# echo "[speech] NUMBA_CACHE_DIR: $NUMBA_CACHE_DIR"

# Check if async_io is available
python3 -c "
try:
    from deepspeed.ops.op_builder import AsyncIOBuilder
    b = AsyncIOBuilder()
    if b.is_compatible():
        print('[speech] AsyncIO extension is compatible')
    else:
        print('[speech] AsyncIO extension is not compatible')
except Exception as e:
    print(f'[speech] AsyncIO check failed: {e}')
" 2>/dev/null || true

# Start the server, filter compiler warnings from stderr
exec stdbuf -oL -eL python3 /workspace/speech/server.py "$@" 2> >(grep -v "warning:")
