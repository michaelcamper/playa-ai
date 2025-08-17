# syntax=docker/dockerfile:1
FROM dustynv/l4t-pytorch:r36.4.0

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONUNBUFFERED=1 \
	PIP_INDEX_URL=https://pypi.org/simple \
	COQUI_TOS_AGREED=1 \
	DEFAULT_SPEAKER_WAV=/workspace/speech/speaker.wav \
	PYTHONPATH=/workspace

# Defaults for easy "docker run speech"
ENV PORT=8009 DEV_RELOAD=0

# System dependencies for audio, builds, and Rust (for sudachipy)
RUN apt-get update && \
	apt-get install -y --no-install-recommends \
		build-essential \
		cmake ninja-build \
		protobuf-compiler libprotobuf-dev \
		libopenblas-dev \
		python3-dev \
		rustc cargo \
		libaio-dev libaio1 \
		libasound2 libasound2-dev \
		libsndfile1 libsndfile1-dev \
		libportaudio2 portaudio19-dev \
		python3-pip && \
	apt-get remove -y python3-blinker || true && \
	rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install Python dependencies first to leverage layer caching
COPY speech/requirements.txt /workspace/speech/requirements.txt


RUN pip3 install --upgrade pip

# Build prerequisites for CTranslate2 Python bindings
RUN pip3 install --no-cache-dir pybind11 scikit-build

# Build environment (set before building CTranslate2 so Python bindings can find headers/libs)
ENV DS_BUILD_AIO=1 \
	DS_BUILD_SPARSE_ATTN=0 \
	DS_BUILD_CUTLASS=1 \
	CUTLASS_PATH=/opt/cutlass \
	CFLAGS="-I/usr/local/include -I/usr/include -I/usr/include/aarch64-linux-gnu" \
	LDFLAGS="-L/usr/local/lib -L/usr/lib/aarch64-linux-gnu -L/usr/lib" \
	LD_LIBRARY_PATH="/usr/local/lib:/usr/lib/aarch64-linux-gnu:/usr/lib:${LD_LIBRARY_PATH}" \
	TORCH_CUDA_ARCH_LIST="8.7" \
	CUDA_HOME=/usr/local/cuda \
	CUDACXX=/usr/local/cuda/bin/nvcc \
	CMAKE_PREFIX_PATH=/usr/local \
	CMAKE_BUILD_PARALLEL_LEVEL=2 \
	MAX_JOBS=4 \
	TORCH_NVCC_FLAGS="-w" \
	CXXFLAGS="-Wno-narrowing -w" \
	WHISPER_MODEL_SIZE=small.en \
	WHISPER_DOWNLOAD_ROOT=/workspace/models

# Build and install CTranslate2 from source with CUDA support (sm_87)
RUN git clone --branch v4.6.0 --depth 1 --recurse-submodules https://github.com/OpenNMT/CTranslate2.git /opt/ctranslate2 && \
	cd /opt/ctranslate2 && git submodule update --init --recursive && mkdir -p build && cd build && \
	cmake -DWITH_CUDA=ON -DWITH_CUDNN=ON -DCMAKE_CUDA_ARCHITECTURES=87 -DWITH_MKL=OFF -DCMAKE_BUILD_TYPE=Release .. && \
	make -j$(nproc) && make install && ldconfig && \
	pip3 uninstall -y ctranslate2 || true && \
	CMAKE_PREFIX_PATH=/usr/local pip3 install --no-binary=:all: /opt/ctranslate2/python

# Install Coqui TTS at the Baseten commit;
RUN pip3 install --no-cache-dir 'git+https://github.com/coqui-ai/TTS@fa28f99f1508b5b5366539b2149963edcb80ba62'

RUN git clone --depth=1 https://github.com/NVIDIA/cutlass.git /opt/cutlass && \
	ln -sf /usr/lib/aarch64-linux-gnu/libaio.so.1.0.1 /usr/lib/aarch64-linux-gnu/libaio.so && \
	ln -sf /usr/lib/aarch64-linux-gnu/libaio.so.1.0.1 /usr/lib/libaio.so && \
	ldconfig

# Additional build dependency for CTranslate2 Python bindings
# Set build environment for DeepSpeed (already set above, kept here for clarity at this stage)
	
RUN pip3 install --no-cache-dir -r /workspace/speech/requirements.txt


# Pre-build DeepSpeed extensions
RUN python3 -c "import deepspeed; print('DeepSpeed version:', deepspeed.__version__)" && \
	python3 -c "from deepspeed.ops.op_builder import AsyncIOBuilder; b = AsyncIOBuilder(); print('AsyncIO compatible:', b.is_compatible())" || true

# Preload faster-whisper model (CPU device during build, no GPU needed)
RUN python3 - <<'PY'
import os
size = os.getenv('WHISPER_MODEL_SIZE', 'small.en')
root = os.getenv('WHISPER_DOWNLOAD_ROOT', '/workspace/models')
print(f"[build] Preloading faster-whisper model: {size} -> {root}")
from faster_whisper import WhisperModel
# Use CPU/float32 at build time to download files without requiring INT8 backends
model = WhisperModel(size, device="cpu", compute_type="float32", download_root=root, local_files_only=False)
print("[build] faster-whisper model ready")
PY

# Copy app code
COPY speech/ /workspace/speech/

# Make entrypoint executable (ensure it exists and has proper permissions)
RUN test -f /workspace/speech/entrypoint.sh && chmod +x /workspace/speech/entrypoint.sh || echo "Warning: entrypoint.sh not found"

# Preload XTTS v2 using BuildKit secret .env so token isn't baked in
RUN --mount=type=secret,id=envfile bash -lc 'set -a; source /run/secrets/envfile; set +a; \
export HF_HUB_ENABLE_HF_TRANSFER=0; \
python3 -c "from huggingface_hub import snapshot_download; import os; print(\"Preloading XTTS v2...\"); snapshot_download(repo_id=\"coqui/XTTS-v2\", local_dir=\"/workspace/models/xtts_v2\", token=os.getenv(\"HUGGINGFACE_TOKEN\")); print(\"XTTS v2 preloaded\")"'

EXPOSE 8009

# Use bash to execute the entrypoint script to avoid permission issues
ENTRYPOINT ["/bin/bash", "/workspace/speech/entrypoint.sh"]






