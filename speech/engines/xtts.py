"""Self-contained XTTS engine (no local dependencies).

Provides:
- initialize(model_dir)
- stream(text, chunk_size=128, language='en') -> generator of mono float32 numpy chunks
- synthesize_to_wav(text, out_path)
- get_sample_rate()
"""

from typing import Optional, Iterable, Generator
import os
import numpy as np
import torch
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
import wave


# Torch performance tweaks
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
try:
	torch.set_float32_matmul_precision("high")
except Exception:
	pass


_model: Optional[Xtts] = None
_gpt_latent = None
_spk_emb = None
_sample_rate: int = 24_000


def get_sample_rate() -> int:
	return _sample_rate


def _chunk_to_mono_f32(x) -> np.ndarray:
	if isinstance(x, torch.Tensor):
		x = x.detach().to("cpu").float().numpy()
	else:
		x = np.asarray(x, dtype=np.float32)
	if x.ndim > 1:
		x = np.squeeze(x)
	return x.astype(np.float32).reshape(-1, 1)


def initialize(model_dir: str) -> None:
	"""Load XTTS model and prepare conditioning latents."""
	global _model, _gpt_latent, _spk_emb, _sample_rate
	_sample_rate = 24000

	config_path = os.path.join(model_dir, "config.json")
	config = XttsConfig()
	config.load_json(config_path)
	_model = Xtts.init_from_config(config)

	# Use DeepSpeed unconditionally
	_model.load_checkpoint(config, checkpoint_dir=model_dir, use_deepspeed=True, eval=True)

	_model.to("cuda")

	# Precompute default conditioning latents if a default speaker exists
	default_spk = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "speaker.wav")
	if os.path.exists(default_spk):
		try:
			lat = _model.get_conditioning_latents(audio_path=default_spk)
			_gpt_latent = lat["gpt_cond_latent"] if isinstance(lat, dict) else lat[0]
			_spk_emb = lat["speaker_embedding"] if isinstance(lat, dict) else lat[1]
		except Exception:
			_gpt_latent = None
			_spk_emb = None


def stream(text: str, chunk_size: int = 128, language: str = "en") -> Generator[np.ndarray, None, None]:
	"""Yield mono float32 chunks for the given text."""
	if _model is None:
		raise RuntimeError("XTTS not initialized")
	text = (text or "").strip()
	if not text:
		raise ValueError("text is required")

	# Ensure conditioning latents
	global _gpt_latent, _spk_emb
	if _gpt_latent is None or _spk_emb is None:
		default_spk = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "speaker.wav")
		lat = _model.get_conditioning_latents(audio_path=default_spk) if os.path.exists(default_spk) else _model.get_conditioning_latents()
		_gpt_latent = lat["gpt_cond_latent"] if isinstance(lat, dict) else lat[0]
		_spk_emb = lat["speaker_embedding"] if isinstance(lat, dict) else lat[1]

	with torch.inference_mode():
		for pcm in _model.inference_stream(
			text=text,
			gpt_cond_latent=_gpt_latent,
			speaker_embedding=_spk_emb,
			stream_chunk_size=chunk_size,
			language=language,
			enable_text_splitting=(len(text) > 200),
		):
			yield _chunk_to_mono_f32(pcm)


def synthesize_to_wav(text: str, out_path: str) -> dict:
	"""Synthesize the text and write a 16-bit PCM WAV at out_path."""
	chunks: list[np.ndarray] = []
	for c in stream(text):
		chunks.append(c)
	if not chunks:
		return {"ok": False, "error": "no audio generated"}
	pcm = np.vstack(chunks)
	pcm16 = np.clip(pcm, -1.0, 1.0)
	pcm16 = (pcm16 * 32767.0).astype(np.int16).reshape(-1)
	os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
	with wave.open(out_path, "wb") as wf:
		wf.setnchannels(1)
		wf.setsampwidth(2)
		wf.setframerate(_sample_rate)
		wf.writeframes(pcm16.tobytes())
	return {"ok": True, "path": out_path}
