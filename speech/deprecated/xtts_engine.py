import os
import threading
import queue as q
from typing import Optional

import numpy as np
import sounddevice as sd
from collections import deque
from fastapi.responses import JSONResponse
import time
import warnings
import logging
import wave

from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
import torch

# Enable TF32 for faster matmul on Ampere
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
try:
	torch.set_float32_matmul_precision("high")
except Exception:
	pass

# Additional optimizations
torch.backends.cudnn.benchmark = True  # Auto-tune convolution algorithms
torch.backends.cuda.matmul.allow_fp16_reduced_precision_reduction = True

# Silence only specific noisy warnings from dependencies
warnings.filterwarnings(
	"ignore",
	message=r".*`torch.load` with `weights_only=False`.*",
	category=FutureWarning,
)

# Silence noisy DeepSpeed warnings in logs
logging.getLogger("deepspeed").setLevel(logging.ERROR)
logging.getLogger("deepspeed.ops").setLevel(logging.ERROR)
logging.getLogger("deepspeed.runtime").setLevel(logging.ERROR)

# Suppress DeepSpeed build warnings that can't be fixed due to version constraints
os.environ['DS_SKIP_CUDA_CHECK'] = '1'
warnings.filterwarnings("ignore", message=r".*async_io requires.*")
warnings.filterwarnings("ignore", message=r".*CUTLASS.*")
warnings.filterwarnings("ignore", message=r".*sparse_attn.*")
warnings.filterwarnings("ignore", message=r".*triton.*")

_xtts_native: Optional[Xtts] = None
_xtts_gpt_latent = None
_xtts_spk_emb = None
_sample_rate: int = 24_000
_output_device_index: Optional[int] = None

def _resolve_asset(filename: str) -> str:
    # Prefer new assets folder; fallback to legacy path
    cand1 = os.path.join("/workspace/speech/assets", filename)
    cand2 = os.path.join("/workspace/speech", filename)
    return cand1 if os.path.exists(cand1) else cand2

DEFAULT_SPEAKER_WAV = _resolve_asset("speaker.wav")
_BLOCKSIZE: int = 1024  # ~42 ms at 24 kHz - balanced for smooth playback

# Persistent playback engine state
_play_deque: "deque[np.ndarray]" = deque()
_deque_lock = threading.Lock()
_queued_samples: int = 0
_stream: Optional[sd.OutputStream] = None
_engine_running = False
_hold_idle = False  # when True, do not feed waiting.wav
_waiting_wav_path = _resolve_asset("waiting.wav")
_waiting_thread: Optional[threading.Thread] = None
_waiting_stop_evt = threading.Event()


def set_output_device_index(index: Optional[int]):
	global _output_device_index
	_output_device_index = index


def get_sample_rate() -> int:
	return _sample_rate


def get_blocksize() -> int:
	return _BLOCKSIZE


def initialize_xtts(model_dir: str):
	global _xtts_native, _xtts_gpt_latent, _xtts_spk_emb, _sample_rate
	_sample_rate = 24000

	# Use preloaded XTTS model directory directly (Dockerfile preloads it)
	config_path = os.path.join(model_dir, "config.json")
	config = XttsConfig()
	config.load_json(config_path)
	_xtts_native = Xtts.init_from_config(config)

	# Check if DeepSpeed should be disabled for stability
	use_deepspeed = os.getenv("DISABLE_DEEPSPEED", "0") not in ("1", "true", "TRUE")
	
	if use_deepspeed:
		# Try to load checkpoint with DeepSpeed, fallback to regular loading if it fails
		try:
			# Check if DeepSpeed extensions are available
			import deepspeed
			from deepspeed.ops.op_builder import AsyncIOBuilder
			aio_available = False
			try:
				builder = AsyncIOBuilder()
				if builder.is_compatible():
					aio_available = True
			except:
				pass
			
			_xtts_native.load_checkpoint(config, checkpoint_dir=model_dir, use_deepspeed=True, eval=True)
			print(f"[speech] XTTS checkpoint loaded (deepspeed=on, async_io={'available' if aio_available else 'unavailable'})", flush=True)
		except Exception as e:
			print(f"[speech] DeepSpeed loading failed ({e}), falling back to regular loading", flush=True)
			_xtts_native.load_checkpoint(config, checkpoint_dir=model_dir, use_deepspeed=False, eval=True)
			print("[speech] XTTS checkpoint loaded (deepspeed=off)", flush=True)
	else:
		# Load without DeepSpeed for more consistent performance
		_xtts_native.load_checkpoint(config, checkpoint_dir=model_dir, use_deepspeed=False, eval=True)
		print("[speech] XTTS checkpoint loaded (deepspeed=off by request)", flush=True)
	
	_xtts_native.to("cuda")

	# Precompute conditioning latents BEFORE converting model to half (required for compatibility)
	try:
		lat = _xtts_native.get_conditioning_latents(audio_path=DEFAULT_SPEAKER_WAV)
		_xtts_gpt_latent = lat["gpt_cond_latent"] if isinstance(lat, dict) else lat[0]
		_xtts_spk_emb = lat["speaker_embedding"] if isinstance(lat, dict) else lat[1]
		print("[speech] conditioning latents ready", flush=True)
	except Exception as e:
		print(f"[speech] conditioning failed: {e}", flush=True)
		_xtts_gpt_latent = None
		_xtts_spk_emb = None
	
	# Keep model in float32 for compatibility
	# FP16 causes issues with XTTS inference pipeline
	print("[speech] Model using FP32 for compatibility", flush=True)
		
	# Warmup inference to compile CUDA kernels
	if _xtts_gpt_latent is not None and _xtts_spk_emb is not None:
		print("[speech] Running warmup inference...", flush=True)
		try:
			with torch.inference_mode():
				list(_xtts_native.inference_stream(
					text="Hello world",
					gpt_cond_latent=_xtts_gpt_latent,
					speaker_embedding=_xtts_spk_emb,
					stream_chunk_size=512,
					language="en",
				))
			print("[speech] Warmup complete - CUDA kernels compiled", flush=True)
		except Exception as warmup_e:
			print(f"[speech] Warmup failed (non-critical): {warmup_e}", flush=True)


def _chunk_to_numpy_mono_f32(x) -> np.ndarray:
	# Accept torch tensor on CUDA/CPU or numpy list/array; return float32 mono column vector
	if isinstance(x, torch.Tensor):
		x = x.detach().to("cpu").float().numpy()
	else:
		x = np.asarray(x, dtype=np.float32)
	# ensure 1-D
	if x.ndim > 1:
		x = np.squeeze(x)
	return x.astype(np.float32).reshape(-1, 1)


def _output_callback(outdata, frames, time_info, status):
	global _queued_samples
	total_written = 0
	while total_written < frames:
		with _deque_lock:
			if _play_deque:
				arr = _play_deque[0]
				avail = arr.shape[0]
				need = frames - total_written
				to_copy = min(avail, need)
				outdata[total_written:total_written+to_copy, 0] = arr[:to_copy, 0]
				if to_copy < avail:
					_play_deque[0] = arr[to_copy:]
				else:
					_play_deque.popleft()
				_queued_samples = max(0, _queued_samples - to_copy)
				total_written += to_copy
				continue
			break
	# zero-fill
	if total_written < frames:
		outdata[total_written:frames, 0] = 0.0
		# do not change _queued_samples here; we only track queued, not played


def _enqueue_pcm(pcm: np.ndarray):
	global _queued_samples
	if pcm is None or pcm.size == 0:
		return
	with _deque_lock:
		_play_deque.append(pcm.astype(np.float32).reshape(-1, 1))
		_queued_samples += pcm.shape[0]


def _loop_waiting_audio():
	"""Background thread: keep enqueuing waiting.wav while engine is idle."""
	from pathlib import Path
	if not Path(_waiting_wav_path).exists():
		return
	while not _waiting_stop_evt.is_set():
		if _hold_idle:
			time.sleep(0.05)
			continue
		# Keep at least ~500ms of audio buffered
		needed = int(0.5 * _sample_rate)
		with _deque_lock:
			have = _queued_samples
		if have >= needed:
			time.sleep(0.05)
			continue
		# Enqueue a chunk from waiting.wav
		try:
			for pcm, sr in _iter_wav_chunks(_waiting_wav_path, target_chunk_samples=4096):
				if _waiting_stop_evt.is_set() or _hold_idle:
					break
				if sr != _sample_rate:
					# rudimentary resample (nearest) to avoid dependency; acceptable for waiting tone
					ratio = sr / float(_sample_rate)
					idx = (np.arange(0, pcm.shape[0]) / ratio).astype(np.int64)
					idx = idx[idx < pcm.shape[0]]
					pcm = pcm[idx]
				_enqueue_pcm(_chunk_to_numpy_mono_f32(pcm))
		except Exception:
			# sleep a bit to avoid tight loop if file problem
			time.sleep(0.2)

def speak(text: str):
	if _xtts_native is None:
		return JSONResponse({"error": "XTTS not initialized"}, status_code=500)

	text = (text or "").strip()
	if not text:
		return JSONResponse({"error": "text is required"}, status_code=400)

	global _xtts_gpt_latent, _xtts_spk_emb
	if (_xtts_gpt_latent is None or _xtts_spk_emb is None):
		try:
			lat = _xtts_native.get_conditioning_latents(audio_path=DEFAULT_SPEAKER_WAV)
			_xtts_gpt_latent = lat["gpt_cond_latent"] if isinstance(lat, dict) else lat[0]
			_xtts_spk_emb = lat["speaker_embedding"] if isinstance(lat, dict) else lat[1]
			print("[speech] conditioning latents ready (lazy)", flush=True)
		except Exception as e:
			print(f"[speech] conditioning failed (lazy): {e}", flush=True)

	if not (_xtts_gpt_latent is not None and _xtts_spk_emb is not None):
		return JSONResponse({"error": "speaker latents unavailable"}, status_code=500)

	# Timing and metrics
	start_ts = time.monotonic()
	first_pcm_ts = {"t": None}
	first_audio_ts = {"t": None}
	written_samples = {"n": 0}

	# Prepare TTS streaming in background (unbounded queue to avoid dropping audio)
	chunk_queue: "q.Queue[np.ndarray]" = q.Queue()
	done_evt = threading.Event()
	first_chunk_ready = threading.Event()

	def _tts_worker():
		try:
			first_emitted = False
			# Adjust streaming parameters based on text length to avoid over-segmentation
			chunk_size = 96
			do_split = len(text) > 200
			with torch.inference_mode():
				for pcm in _xtts_native.inference_stream(
					text=text,
					gpt_cond_latent=_xtts_gpt_latent,
					speaker_embedding=_xtts_spk_emb,
					stream_chunk_size=chunk_size,
					language="en",
					enable_text_splitting=do_split,
				):
					arr = _chunk_to_numpy_mono_f32(pcm)
					chunk_queue.put(arr)
					if not first_emitted:
						first_pcm_ts["t"] = time.monotonic()
						first_chunk_ready.set()
						first_emitted = True
		except Exception as e:
			print(f"[speech] native inference_stream failed: {e}", flush=True)
		finally:
			done_evt.set()

	worker = threading.Thread(target=_tts_worker, daemon=True)
	worker.start()

	# Wait for first chunk only; exit if producer finishes with no audio.
	while not first_chunk_ready.is_set():
		if done_evt.is_set():
			return JSONResponse({"error": "native_xtts_missing_or_failed"}, status_code=500)
		first_chunk_ready.wait(timeout=0.25)

	# Pause idle feeder while we enqueue TTS
	global _hold_idle
	prev_hold = _hold_idle
	_hold_idle = True
	try:
		# Small head padding to ensure leading transient is preserved
		_enqueue_pcm(np.zeros((int(0.1 * _sample_rate), 1), dtype=np.float32))
		# Buffer an initial amount of TTS audio
		buffer_target = int(0.15 * _sample_rate)
		buffered = 0
		while buffered < buffer_target:
			try:
				pcm = chunk_queue.get(timeout=2.0)
				if pcm.size:
					_enqueue_pcm(pcm)
					buffered += pcm.shape[0]
			except q.Empty:
				if done_evt.is_set() and buffered == 0:
					return JSONResponse({"error": "native_xtts_missing_or_failed"}, status_code=500)
				break
		# Continue feeding until producer finishes and queue drains
		while True:
			try:
				pcm = chunk_queue.get(timeout=0.5)
				if pcm.size:
					_enqueue_pcm(pcm)
			except q.Empty:
				with _deque_lock:
					empty = (len(_play_deque) == 0)
				if done_evt.is_set() and empty:
					break
				continue
	finally:
		_hold_idle = prev_hold

	end_ts = time.monotonic()
	audio_sec = written_samples["n"] / float(_sample_rate)
	processing_time = end_ts - start_ts
	rtf = (audio_sec / processing_time) if processing_time > 0 else 0.0
	t2first_pcm_ms = (first_pcm_ts["t"] - start_ts) * 1000.0 if first_pcm_ts["t"] else None
	t2first_audio_ms = (first_audio_ts["t"] - start_ts) * 1000.0 if first_audio_ts["t"] else None
	print(f" > Time to first PCM: {t2first_pcm_ms:.2f} ms" if t2first_pcm_ms is not None else " > Time to first PCM: n/a", flush=True)
	print(f" > Time to first audio: {t2first_audio_ms:.2f} ms" if t2first_audio_ms is not None else " > Time to first audio: n/a", flush=True)
	print(f" > Processing time: {processing_time}", flush=True)
	print(f" > Real-time factor: {rtf}", flush=True)

	return {"ok": True}


def synthesize_to_wav(text: str, out_path: str):
	"""Synthesize text to a WAV file at out_path (16-bit PCM, 24 kHz)."""
	if _xtts_native is None:
		return {"ok": False, "error": "XTTS not initialized"}
	text = (text or "").strip()
	if not text:
		return {"ok": False, "error": "text is required"}
	# Ensure conditioning
	global _xtts_gpt_latent, _xtts_spk_emb
	if (_xtts_gpt_latent is None or _xtts_spk_emb is None):
		try:
			lat = _xtts_native.get_conditioning_latents(audio_path=DEFAULT_SPEAKER_WAV)
			_xtts_gpt_latent = lat["gpt_cond_latent"] if isinstance(lat, dict) else lat[0]
			_xtts_spk_emb = lat["speaker_embedding"] if isinstance(lat, dict) else lat[1]
		except Exception as e:
			return {"ok": False, "error": f"conditioning failed: {e}"}
	# Collect PCM
	chunks: list[np.ndarray] = []
	with torch.inference_mode():
		for pcm in _xtts_native.inference_stream(
			text=text,
			gpt_cond_latent=_xtts_gpt_latent,
			speaker_embedding=_xtts_spk_emb,
			stream_chunk_size=128,
			language="en",
			enable_text_splitting=(len(text) > 200),
		):
			arr = _chunk_to_numpy_mono_f32(pcm)
			chunks.append(arr)
	if not chunks:
		return {"ok": False, "error": "no audio generated"}
	pcm = np.vstack(chunks)  # float32 mono [-1,1]
	# Convert to int16
	pcm16 = np.clip(pcm, -1.0, 1.0)
	pcm16 = (pcm16 * 32767.0).astype(np.int16).reshape(-1)
	# Write wav
	import wave, os
	os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
	with wave.open(out_path, "wb") as wf:
		wf.setnchannels(1)
		wf.setsampwidth(2)
		wf.setframerate(_sample_rate)
		wf.writeframes(pcm16.tobytes())
	return {"ok": True, "path": out_path}

def start_output_stream():
	"""Open persistent output stream and start waiting.wav loop."""
	global _stream, _engine_running
	if _engine_running and _stream is not None:
		return {"ok": True, "status": "already_running"}
	# Clear buffers
	with _deque_lock:
		_play_deque.clear()
		global _queued_samples
		_queued_samples = 0
	# Start stream
	_stream = sd.OutputStream(
		samplerate=_sample_rate,
		channels=1,
		dtype="float32",
		device=_output_device_index,
		blocksize=_BLOCKSIZE,
		latency=0.1,
		callback=_output_callback,
	)
	_stream.start()
	_engine_running = True
	# Start waiting audio thread
	_waiting_stop_evt.clear()
	thread = threading.Thread(target=_loop_waiting_audio, daemon=True)
	thread.start()
	global _waiting_thread
	_waiting_thread = thread
	return {"ok": True}


def stop_output_stream():
	"""Stop persistent output stream and background waiting thread."""
	global _stream, _engine_running
	_waiting_stop_evt.set()
	if _waiting_thread and _waiting_thread.is_alive():
		_waiting_thread.join(timeout=1.0)
	with _deque_lock:
		_play_deque.clear()
		global _queued_samples
		_queued_samples = 0
	if _stream is not None:
		try:
			_stream.stop()
			_stream.close()
		except Exception:
			pass
		finally:
			_stream = None
	_engine_running = False
	return {"ok": True}


def play_wav_once(path: str):
	"""Enqueue a WAV file for playback over persistent stream."""
	global _hold_idle
	_hold_idle = True  # pause waiting.wav feed
	try:
		for pcm, sr in _iter_wav_chunks(path, target_chunk_samples=4096):
			if sr != _sample_rate:
				# naive nearest resample
				ratio = sr / float(_sample_rate)
				idx = (np.arange(0, pcm.shape[0]) / ratio).astype(np.int64)
				idx = idx[idx < pcm.shape[0]]
				pcm = pcm[idx]
			_enqueue_pcm(_chunk_to_numpy_mono_f32(pcm))
	finally:
		_hold_idle = False
	return {"ok": True}


def _iter_wav_chunks(file_path: str, target_chunk_samples: int = 2048):
	"""Yield (mono_f32_chunk, sample_rate) from a WAV file in chunks."""
	with wave.open(file_path, "rb") as wf:
		n_channels = wf.getnchannels()
		width_bytes = wf.getsampwidth()
		sr = wf.getframerate()
		if width_bytes == 2:
			dtype = np.int16
		elif width_bytes == 1:
			dtype = np.int8
		else:
			raise RuntimeError("Unsupported WAV sample width: %d" % width_bytes)
		frames_per_read = max(1, target_chunk_samples)
		while True:
			frames = wf.readframes(frames_per_read)
			if not frames:
				break
			arr = np.frombuffer(frames, dtype=dtype)
			if n_channels > 1:
				arr = arr.reshape(-1, n_channels).mean(axis=1)
			# normalize to float32 mono column vector
			if dtype is np.int16:
				arr = (arr.astype(np.float32) / 32768.0)
			else:
				arr = (arr.astype(np.float32) / 128.0)
			yield arr.reshape(-1, 1), sr


def play_speaker_wav():
	"""Play DEFAULT_SPEAKER_WAV through the same audio pipeline for debugging."""
	file_path = DEFAULT_SPEAKER_WAV
	start_ts = time.monotonic()
	first_audio_ts = {"t": None}
	written_samples = {"n": 0}

	chunk_queue: "q.Queue[np.ndarray]" = q.Queue()
	done_evt = threading.Event()
	first_chunk_ready = threading.Event()
	sample_rate_box = {"sr": _sample_rate}

	def _wav_worker():
		try:
			first = True
			for pcm, sr in _iter_wav_chunks(file_path, target_chunk_samples=2048):
				sample_rate_box["sr"] = sr
				chunk_queue.put(pcm)
				if first:
					first_chunk_ready.set()
					first = False
		except Exception as e:
			print(f"[speech] wav worker failed: {e}", flush=True)
		finally:
			done_evt.set()

	worker = threading.Thread(target=_wav_worker, daemon=True)
	worker.start()

	# Playback buffer and callback (reuse same design)
	play_deque: "deque[np.ndarray]" = deque()
	deque_lock = threading.Lock()
	current = {"arr": None, "pos": 0}

	def _audio_callback(outdata, frames, time_info, status):
		total_written = 0
		out = outdata
		while total_written < frames:
			with deque_lock:
				if current["arr"] is None or current["pos"] >= (0 if current["arr"] is None else current["arr"].shape[0]):
					if play_deque:
						current["arr"] = play_deque.popleft()
						current["pos"] = 0
					else:
						break
				arr = current["arr"]
				pos = current["pos"]
				avail = arr.shape[0] - pos if arr is not None else 0
				need = frames - total_written
				to_copy = min(avail, need) if arr is not None else 0
				if to_copy > 0:
					out[total_written:total_written+to_copy, 0] = arr[pos:pos+to_copy, 0]
					current["pos"] += to_copy
					total_written += to_copy
					continue
				break
		if total_written < frames:
			out[total_written:frames, 0] = 0.0
		written_samples["n"] += frames

	with sd.OutputStream(
		samplerate=sample_rate_box["sr"],
		channels=1,
		dtype="float32",
		device=_output_device_index,
		blocksize=_BLOCKSIZE,
		latency=0.1,
		callback=_audio_callback,
	) as stream:
		# Ensure the stream is not running until we have prebuffered audio
		try:
			stream.stop()
		except Exception:
			pass
		# Wait for first chunk
		while not first_chunk_ready.is_set():
			if done_evt.is_set():
				return JSONResponse({"error": "wav_missing_or_failed"}, status_code=500)
			first_chunk_ready.wait(timeout=0.25)

		# Buffer initial audio then start stream (same sequence as XTTS)
		pre_roll_samples = int(0.30 * sample_rate_box["sr"]) or 1
		with deque_lock:
			play_deque.append(np.zeros((pre_roll_samples, 1), dtype=np.float32))

		target_buffer_samples = int(0.15 * sample_rate_box["sr"]) or _BLOCKSIZE
		buffered = 0
		while buffered < target_buffer_samples:
			try:
				pcm = chunk_queue.get(timeout=1.0)
				if pcm.size:
					with deque_lock:
						play_deque.append(pcm)
					buffered += pcm.shape[0]
			except q.Empty:
				if done_evt.is_set() and buffered == 0:
					return JSONResponse({"error": "wav_missing_or_failed"}, status_code=500)
				break

		first_audio_ts["t"] = time.monotonic()
		try:
			stream.start()
		except Exception:
			pass

		# Keep feeding until queue and playback deques drain
		while True:
			try:
				pcm = chunk_queue.get(timeout=0.5)
				if pcm.size:
					with deque_lock:
						play_deque.append(pcm)
			except q.Empty:
				with deque_lock:
					empty = (len(play_deque) == 0)
				if done_evt.is_set() and empty:
					break
				continue

	end_ts = time.monotonic()
	audio_sec = written_samples["n"] / float(sample_rate_box["sr"]) if sample_rate_box["sr"] else 0.0
	processing_time = end_ts - start_ts
	rtf = (audio_sec / processing_time) if processing_time > 0 else 0.0
	print(f"[wav] Processing time: {processing_time}", flush=True)
	print(f"[wav] Real-time factor: {rtf}", flush=True)
	return {"ok": True}

