from typing import Any, Dict, Iterable, Optional
import os
import threading
from collections import deque
import time
import wave

import numpy as np
import sounddevice as sd


# Speaker: single persistent output stream with a queue
_stream: Optional[sd.OutputStream] = None
_deque: "deque[np.ndarray]" = deque()
_lock = threading.Lock()
_queued_samples: int = 0
_running = False

_sample_rate: int = 24_000
_blocksize: int = 1024
_output_device_index: Optional[int] = None

_waiting_wav_path = "/workspace/speech/assets/waiting.wav"
_waiting_thread: Optional[threading.Thread] = None
_waiting_stop = threading.Event()
_idle_hold = False
_fade_ms: int = 50


def configure(sample_rate: Optional[int] = None, blocksize: Optional[int] = None, output_device: Optional[int] = None, waiting_wav: Optional[str] = None, fade_ms: Optional[int] = None) -> None:
	global _sample_rate, _blocksize, _output_device_index, _waiting_wav_path, _fade_ms
	if sample_rate is not None:
		_sample_rate = int(sample_rate)
	if blocksize is not None:
		_blocksize = int(blocksize)
	if output_device is not None:
		_output_device_index = output_device
	if waiting_wav:
		_waiting_wav_path = waiting_wav
	if fade_ms is not None:
		_fade_ms = max(0, int(fade_ms))


def pause_waiting_audio() -> None:
	"""Pause the waiting audio to prevent interference during recording or other operations."""
	global _idle_hold, _queued_samples
	_idle_hold = True
	# Clear any queued waiting audio for immediate effect
	with _lock:
		_deque.clear()
		_queued_samples = 0


def resume_waiting_audio() -> None:
	"""Resume the waiting audio after operations are complete."""
	global _idle_hold
	_idle_hold = False


def _callback(outdata, frames, time_info, status):
	global _queued_samples
	written = 0
	while written < frames:
		with _lock:
			if _deque:
				arr = _deque[0]
				avail = arr.shape[0]
				need = frames - written
				cnt = min(avail, need)
				outdata[written:written+cnt, 0] = arr[:cnt, 0]
				if cnt < avail:
					_deque[0] = arr[cnt:]
				else:
					_deque.popleft()
				_queued_samples = max(0, _queued_samples - cnt)
				written += cnt
				continue
			break
	if written < frames:
		outdata[written:frames, 0] = 0.0


def _enqueue(pcm_f32_mono: np.ndarray) -> None:
	global _queued_samples
	if pcm_f32_mono is None or pcm_f32_mono.size == 0:
		return
	with _lock:
		_deque.append(pcm_f32_mono.astype(np.float32).reshape(-1, 1))
		_queued_samples += pcm_f32_mono.shape[0]


def _get_queued_samples() -> int:
	with _lock:
		return _queued_samples


def _wait_until_drain(poll_interval_s: float = 0.01, timeout_s: Optional[float] = None, shutdown_event: Optional[threading.Event] = None) -> None:
	start = time.monotonic()
	while True:
		# Check for shutdown event
		if shutdown_event and shutdown_event.is_set():
			return
		
		if _get_queued_samples() <= 0:
			return
		if timeout_s is not None and (time.monotonic() - start) > timeout_s:
			return
		time.sleep(poll_interval_s)


def _iter_wav(path: str, chunk: int = 4096):
	with wave.open(path, "rb") as wf:
		nc, sw, sr = wf.getnchannels(), wf.getsampwidth(), wf.getframerate()
		dtype = np.int16 if sw == 2 else (np.int8 if sw == 1 else None)
		if dtype is None:
			raise RuntimeError("Unsupported WAV sample width")
		frames = max(1, chunk)
		while True:
			b = wf.readframes(frames)
			if not b:
				break
			a = np.frombuffer(b, dtype=dtype)
			if nc > 1:
				a = a.reshape(-1, nc).mean(axis=1)
			# to float32 mono
			if dtype is np.int16:
				a = a.astype(np.float32) / 32768.0
			else:
				a = a.astype(np.float32) / 128.0
			# naive resample if needed (nearest)
			if sr != _sample_rate:
				ratio = sr / float(_sample_rate)
				idx = (np.arange(0, a.shape[0]) / ratio).astype(np.int64)
				idx = idx[idx < a.shape[0]]
				a = a[idx]
			yield a.reshape(-1, 1)


def _waiting_feeder():
	from pathlib import Path
	if not Path(_waiting_wav_path).exists():
		return
	while not _waiting_stop.is_set():
		if _idle_hold:
			time.sleep(0.05)
			continue
		needed = int(0.5 * _sample_rate)
		with _lock:
			have = _queued_samples
		if have >= needed:
			time.sleep(0.05)
			continue
		first = True
		fade_len = int((_fade_ms / 1000.0) * _sample_rate)
		for chunk in _iter_wav(_waiting_wav_path, 4096):
			if _waiting_stop.is_set() or _idle_hold:
				break
			# Apply fade-in at the start of the waiting tone
			if first and fade_len > 0:
				n = min(fade_len, chunk.shape[0])
				if n > 0:
					ramp = np.linspace(0.0, 1.0, n, dtype=np.float32).reshape(-1, 1)
					chunk = chunk.copy()
					chunk[:n, 0] *= ramp[:, 0]
				first = False
			_enqueue(chunk)


def open() -> Dict[str, Any]:
	"""Open and start the single persistent output stream (plays waiting tone when idle)."""
	global _stream, _running, _waiting_thread
	if _running and _stream is not None:
		return {"ok": True, "status": "already_running"}
	# Use only explicitly configured device (int index or str name like "plughw:0,0")
	selected_device = _output_device_index
	if selected_device is None:
		return {"ok": False, "error": "no_output_device", "detail": "Set output_device via speaker.configure (e.g., 'plughw:0,0' or device index)"}
	try:
		_stream = sd.OutputStream(
			samplerate=_sample_rate,
			channels=1,
			dtype="float32",
			device=selected_device,
			blocksize=_blocksize,
			latency=0.1,
			callback=_callback,
		)
		_stream.start()
	except Exception as e:
		return {"ok": False, "error": "stream_open_failed", "detail": str(e), "device": selected_device}
	_running = True
	_waiting_stop.clear()
	_waiting_thread = threading.Thread(target=_waiting_feeder, daemon=True)
	_waiting_thread.start()
	return {"ok": True, "device": selected_device}


def close() -> Dict[str, Any]:
	"""Close the persistent output stream and stop the waiting loop."""
	global _stream, _running
	_waiting_stop.set()
	if _waiting_thread and _waiting_thread.is_alive():
		_waiting_thread.join(timeout=1.0)
	with _lock:
		_deque.clear()
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
	_running = False
	return {"ok": True}


def play_wav(path: str) -> Dict[str, Any]:
	"""Enqueue a WAV file for playback over the persistent output stream."""
	global _idle_hold
	_idle_hold = True
	# Interrupt: flush any waiting audio already queued
	with _lock:
		_deque.clear()
		global _queued_samples
		_queued_samples = 0
	# small head padding to avoid first-sample cut
	_enqueue(np.zeros((int(0.1 * _sample_rate), 1), dtype=np.float32))
	for chunk in _iter_wav(path, 4096):
		# Respect shutdown: stop enqueuing if close has been requested
		if _waiting_stop.is_set():
			break
		_enqueue(chunk)
	# Block until drained, then release waiting feeder
	_wait_until_drain(shutdown_event=_waiting_stop)
	_idle_hold = False
	return {"ok": True}


def play_stream(chunks: Iterable[np.ndarray]) -> Dict[str, Any]:
	"""Play a stream of mono float32 numpy chunks over the persistent stream."""
	global _idle_hold
	# Keep waiting tone active until we receive first actual PCM
	iterator = iter(chunks)
	first_arr = None
	for pcm in iterator:
		if pcm is None:
			continue
		arr = np.asarray(pcm, dtype=np.float32)
		if arr.size == 0:
			continue
		if arr.ndim > 1:
			arr = arr.reshape(-1, arr.shape[-1])[:, 0]
		first_arr = arr.reshape(-1, 1)
		break
	if first_arr is None:
		# nothing to play
		return {"ok": True, "status": "empty_stream"}
	# Interrupt waiting only now and flush queued waiting audio
	_idle_hold = True
	with _lock:
		_deque.clear()
		global _queued_samples
		_queued_samples = 0
	# Enqueue first chunk immediately (no head silence)
	_enqueue(first_arr)
	# Enqueue the rest
	for pcm in iterator:
		# Respect shutdown: stop enqueuing if close has been requested
		if _waiting_stop.is_set():
			break
		if pcm is None:
			continue
		arr = np.asarray(pcm, dtype=np.float32)
		if arr.ndim > 1:
			arr = arr.reshape(-1, arr.shape[-1])[:, 0]
		_enqueue(arr.reshape(-1, 1))
	# Block until drained, then release waiting feeder
	_wait_until_drain(shutdown_event=_waiting_stop)
	_idle_hold = False
	return {"ok": True}





