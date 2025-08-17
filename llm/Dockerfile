FROM dustynv/l4t-pytorch:r36.4.0

# Use PyPI directly
ENV PIP_INDEX_URL=https://pypi.org/simple



RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git curl ca-certificates libcurl4-openssl-dev python3-pip \
 && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir huggingface_hub==0.25.2

# Build llama.cpp
RUN git clone --depth=1 https://github.com/ggerganov/llama.cpp.git /opt/llama.cpp && \
    cd /opt/llama.cpp && \
    cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j$(nproc) && \
    ln -sf /opt/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server

# Download model
RUN rm -rf /models && mkdir -p /models
COPY download_model.py /usr/local/bin/download_model.py
RUN chmod +x /usr/local/bin/download_model.py
RUN --mount=type=secret,id=envfile bash -lc 'set -e; set -a; [ -f /run/secrets/envfile ] && source /run/secrets/envfile || true; set +a; \
    [ -n "${LLM_MODEL_FILE}" ] || { echo "LLM_MODEL_FILE build-arg is required" >&2; exit 2; }; \
    MODEL_FILE="${LLM_MODEL_FILE}" HF_REPO="${LLM_HF_REPO:-}" python3 /usr/local/bin/download_model.py'



# Run llama-server
ENTRYPOINT ["/bin/bash", "-lc", "llama-server --host ${LLM_HOST} --port ${LLM_PORT} --model /models/${LLM_MODEL_FILE} --n-gpu-layers ${LLM_N_GPU_LAYERS} --ctx-size ${LLM_CONTEXT_SIZE} --threads ${LLM_NUM_THREADS} --embedding --alias local-llm"]

