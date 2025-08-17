from typing import Optional
import os

import numpy as np

_model = None


def initialize(model_size: Optional[str] = None, model_dir: Optional[str] = None) -> None:
	"""Load faster-whisper model with CUDA. Fails fast if CUDA is unavailable.

	If `model_dir` exists, load from that directory. Otherwise, try to load by
	model size (e.g., "small.en") with local_files_only=True so no internet is used.
	"""
	global _model
	if _model is not None:
		return
	from faster_whisper import WhisperModel
	# Only CUDA is acceptable
	device = "cuda"
	compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float16")
	# Prefer explicit directory from env or arg
	_env_dir = os.getenv("WHISPER_MODEL_DIR")
	model_dir = model_dir or _env_dir
	try:
		if model_dir and os.path.isdir(model_dir):
			_model = WhisperModel(model_dir, device=device, compute_type=compute_type)
			# fallthrough to warmup
		else:
			# Fallback: size + offline load from download root
			size = model_size or os.getenv("WHISPER_MODEL_SIZE", "small.en")
			download_root = os.getenv("WHISPER_DOWNLOAD_ROOT", "/workspace/models")
			_model = WhisperModel(
				size,
				device=device,
				compute_type=compute_type,
				download_root=download_root,
				local_files_only=True,
			)
	except Exception as e:
		msg = str(e)
		if "not compiled with CUDA" in msg or "CUDA support" in msg:
			raise RuntimeError(
				"CTranslate2/faster-whisper lacks CUDA support. Rebuild the image so ctranslate2 is compiled with CUDA (see Dockerfile)."
			) from e
		raise

	# Fast warmup to compile/load CUDA kernels and cuDNN convs
	try:
		_dummy = np.zeros((8000,), dtype=np.float32)  # 0.5s @ 16kHz
		_model.transcribe(_dummy, language="en")
	except Exception:
		pass


def transcribe(audio_f32_mono: np.ndarray, language: str = "en") -> str:
	"""Transcribe a mono float32 numpy array in [-1, 1] and return text."""
	if audio_f32_mono is None or audio_f32_mono.size == 0:
		return ""
	if _model is None:
		initialize(None)
	segments, _ = _model.transcribe(audio_f32_mono, language=language)
	text = "".join(seg.text for seg in segments)
	return text.strip()
