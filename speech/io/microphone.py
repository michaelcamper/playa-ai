import numpy as np
import sounddevice as sd
import webrtcvad
import threading
import time
import os


def capture(
	max_initial_silence_ms: int,
	max_tail_silence_ms: int,
	sample_rate: int = 16000,
	frame_ms: int = 20,
	shutdown_event: threading.Event = None,
) -> np.ndarray:
	"""Capture a single VAD-gated utterance and return float32 mono in [-1, 1]."""
	assert frame_ms in (10, 20, 30), "webrtcvad supports 10/20/30ms frames"
	vad = webrtcvad.Vad(2)  # Revert back to level 2 (strict)
	frame_len = int(sample_rate * (frame_ms / 1000.0))

	initial_limit = int(max(0, max_initial_silence_ms) / frame_ms)
	tail_limit = int(max(0, max_tail_silence_ms) / frame_ms)

	voiced: list[np.ndarray] = []
	seen_voice = False
	tail_silence = 0
	initial_silence = 0

	# Allow selecting an explicit input device via env var INPUT_DEVICE
	_input_device = None
	try:
		from os import getenv as _getenv
		_env = _getenv("INPUT_DEVICE")
		if _env is not None:
			try:
				_input_device = int(_env)
			except Exception:
				_input_device = _env
	except Exception:
		_input_device = None

	try:
		with sd.InputStream(
			samplerate=sample_rate,
			channels=1,
			dtype="float32",
			blocksize=frame_len,
			device=_input_device,
		) as stream:
			# Optional: settle a couple frames to stabilize levels
			for _ in range(2):
				stream.read(frame_len)
			
			# Aggressive tail handling helpers (no hard cap on utterance length)
			energy_silence_threshold = float(os.getenv("ENERGY_SILENCE_THRESHOLD", "0.003"))
			
			while True:
				# Check for shutdown event
				if shutdown_event and shutdown_event.is_set():
					return np.zeros((0,), dtype=np.float32)
				
				chunk, _ = stream.read(frame_len)
				f32 = chunk.reshape(-1)
				# convert to int16 bytes for VAD
				i16 = (np.clip(f32, -1.0, 1.0) * 32767.0).astype(np.int16)
				try:
					is_speech = vad.is_speech(i16.tobytes(), sample_rate)
				except Exception:
					is_speech = False
				
				# Combine VAD with simple energy gate to exit faster on tail
				rms = float(np.sqrt(np.mean(f32 * f32)) if f32.size else 0.0)
				is_voice = bool(is_speech and (rms >= energy_silence_threshold))

				if not seen_voice:
					if is_voice:
						seen_voice = True
						voiced.append(f32.copy())
						tail_silence = 0
					else:
						initial_silence += 1
						if initial_limit and initial_silence >= initial_limit:
							return np.zeros((0,), dtype=np.float32)
						continue
				else:
					if is_voice:
						voiced.append(f32.copy())
						tail_silence = 0
					else:
						tail_silence += 1
						if tail_limit and tail_silence >= tail_limit:
							break
						voiced.append(f32.copy())
						# No hard cap; allow speaking as long as desired

	except Exception as e:
		# Handle any audio device errors gracefully
		return np.zeros((0,), dtype=np.float32)

	if not voiced:
		return np.zeros((0,), dtype=np.float32)
	return np.concatenate(voiced, axis=0).astype(np.float32)
