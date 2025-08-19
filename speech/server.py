import argparse
import os

from fastapi import FastAPI, Body
from fastapi.responses import JSONResponse, Response
import asyncio
from contextlib import asynccontextmanager
import threading

from speech.io import speaker
from speech.engines import xtts
from speech.engines import whisper
from speech.io import microphone


# Global state for tracking active operations
_active_operations = set()
_operation_lock = threading.Lock()
_shutdown_event = threading.Event()


def register_operation(operation_id: str):
	"""Register an active audio operation."""
	with _operation_lock:
		_active_operations.add(operation_id)


def unregister_operation(operation_id: str):
	"""Unregister a completed audio operation."""
	with _operation_lock:
		_active_operations.discard(operation_id)


def terminate_all_operations():
	"""Terminate all active audio operations."""
	with _operation_lock:
		_shutdown_event.set()
		# Clear all active operations
		_active_operations.clear()
	print(f"[speech] Terminated all active audio operations")


def pause_waiting_audio():
	"""Pause the waiting audio to prevent interference during recording."""
	# Import here to avoid circular imports
	from speech.io.speaker import pause_waiting_audio as speaker_pause
	speaker_pause()


def resume_waiting_audio():
	"""Resume the waiting audio after recording is complete."""
	# Import here to avoid circular imports
	from speech.io.speaker import resume_waiting_audio as speaker_resume
	speaker_resume()


# Wrapper functions that pass shutdown event to speaker operations
def _speaker_play_stream_with_shutdown(text: str):
	"""Wrapper for speaker.play_stream that supports shutdown interruption."""
	# Import here to avoid circular imports
	from speech.io.speaker import _wait_until_drain
	
	# Monkey patch the _wait_until_drain function temporarily
	original_wait = _wait_until_drain
	def interrupted_wait(*args, **kwargs):
		# Remove any existing shutdown_event from kwargs to avoid conflicts
		kwargs.pop('shutdown_event', None)
		return original_wait(*args, shutdown_event=_shutdown_event, **kwargs)
	
	try:
		# Replace the function temporarily
		import speech.io.speaker as speaker_module
		speaker_module._wait_until_drain = interrupted_wait
		
		# Call the original function
		return speaker_module.play_stream(xtts.stream(text))
	finally:
		# Restore the original function
		speaker_module._wait_until_drain = original_wait


def _speaker_play_wav_with_shutdown(path: str):
	"""Wrapper for speaker.play_wav that supports shutdown interruption."""
	# Import here to avoid circular imports
	from speech.io.speaker import _wait_until_drain
	
	# Monkey patch the _wait_until_drain function temporarily
	original_wait = _wait_until_drain
	def interrupted_wait(*args, **kwargs):
		# Remove any existing shutdown_event from kwargs to avoid conflicts
		kwargs.pop('shutdown_event', None)
		return original_wait(*args, shutdown_event=_shutdown_event, **kwargs)
	
	try:
		# Replace the function temporarily
		import speech.io.speaker as speaker_module
		speaker_module._wait_until_drain = interrupted_wait
		
		# Call the original function
		return speaker_module.play_wav(path)
	finally:
		# Restore the original function
		speaker_module._wait_until_drain = original_wait


@asynccontextmanager
async def lifespan(app: FastAPI):
	# Initialize XTTS when the app starts (blocking)
	model_dir = os.getenv("MODEL_DIR", "/workspace/models/xtts_v2")
	try:
		xtts.initialize(model_dir=model_dir)
	except Exception as e:
		print(f"[speech] startup init failed: {e}", flush=True)
	# Preload Whisper for low-latency ASR
	try:
		whisper.initialize(
			model_size=os.getenv("WHISPER_MODEL_SIZE"),
			model_dir=os.getenv("WHISPER_MODEL_DIR"),
		)
	except Exception as e:
		print(f"[speech] whisper preload failed: {e}", flush=True)
	yield

app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
	return {
		"status": "ok",
		"device": "cuda",
		"sample_rate": xtts.get_sample_rate(),
	}

@app.post("/speak")
async def speak(raw_bytes: bytes = Body(...)):
	# Accept plain body containing the text to speak
	text = raw_bytes.decode("utf-8", "ignore").strip()
	if not text:
		return JSONResponse({"error": "text is required"}, status_code=400)

	operation_id = f"speak_{id(text)}"
	register_operation(operation_id)
	
	try:
		# Check if we're shutting down
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		res = await asyncio.to_thread(lambda: _speaker_play_stream_with_shutdown(text))
		if isinstance(res, dict) and not res.get("ok", False):
			return JSONResponse(res, status_code=500)
		return Response(status_code=204)
	finally:
		unregister_operation(operation_id)


ASSETS_DIR = "/workspace/speech/assets"


@app.post("/play")
async def play(raw_bytes: bytes = Body(...)):
	# Accept plain body containing the file name (e.g., "welcome" or "welcome.wav")
	name = (raw_bytes.decode("utf-8", "ignore").strip())
	if not name:
		return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)

	import os as _os
	name = _os.path.basename(name)
	if not name.lower().endswith(".wav"):
		name = f"{name}.wav"
	path = _os.path.join(ASSETS_DIR, name)
	if not _os.path.exists(path):
		return JSONResponse({"ok": False, "error": "file not found", "path": path}, status_code=404)

	operation_id = f"play_{id(name)}"
	register_operation(operation_id)
	
	try:
		# Check if we're shutting down
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		res = await asyncio.to_thread(_speaker_play_wav_with_shutdown, path)
		if isinstance(res, dict) and not res.get("ok", False):
			return JSONResponse(res, status_code=500)
		return Response(status_code=204)
	finally:
		unregister_operation(operation_id)


@app.post("/generate")
async def generate(payload: dict = Body(...)):
	# Accept JSON {"name": "welcome.wav", "text": "Hello ..."}
	name = (payload.get("name") or "").strip()
	text = (payload.get("text") or "").strip()
	if not name:
		return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)
	if not text:
		return JSONResponse({"ok": False, "error": "text is required"}, status_code=400)

	import os as _os
	name = _os.path.basename(name)
	if not name.lower().endswith(".wav"):
		name = f"{name}.wav"
	path = _os.path.join(ASSETS_DIR, name)

	operation_id = f"generate_{id(name)}"
	register_operation(operation_id)
	
	try:
		# Check if we're shutting down
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		res = await asyncio.to_thread(xtts.synthesize_to_wav, text, path)
		if not res.get("ok"):
			return JSONResponse(res, status_code=500)
		return {"path": path}
	finally:
		unregister_operation(operation_id)


@app.post("/open")
async def endpoint_audio_open():
	# Reset shutdown event when opening
	_shutdown_event.clear()
	
	res = await asyncio.to_thread(speaker.open)
	if isinstance(res, dict) and not res.get("ok", False):
		return JSONResponse(res, status_code=500)
	return Response(status_code=204)


@app.post("/close")
async def endpoint_audio_close():
	# Terminate all active operations immediately
	terminate_all_operations()
	
	# Set shutdown event to interrupt any ongoing microphone operations
	_shutdown_event.set()
	
	# Close the speaker
	res = await asyncio.to_thread(speaker.close)
	if isinstance(res, dict) and not res.get("ok", False):
		return JSONResponse(res, status_code=500)
	
	# Small delay to ensure microphone operations are fully terminated
	await asyncio.sleep(0.1)
	
	return Response(status_code=204)


@app.post("/listen")
async def listen(payload: dict = Body(...)):
	# Accepts {"maxInitialSilence": number, "maxTailSilence": number}
	try:
		max_initial = int(payload.get("maxInitialSilence", 0))
		max_tail = int(payload.get("maxTailSilence", 0))
	except Exception:
		return JSONResponse({"ok": False, "error": "Invalid parameters"}, status_code=400)
	
	operation_id = f"listen_{id(payload)}"
	register_operation(operation_id)
	
	try:
		# Check if we're shutting down
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		# Pause waiting audio during recording to prevent interference
		pause_waiting_audio()
		
		# Capture then transcribe with error handling
		try:
			audio = await asyncio.to_thread(microphone.capture, max_initial, max_tail, shutdown_event=_shutdown_event)
			
			# Check again after capture (in case shutdown happened during capture)
			if _shutdown_event.is_set():
				return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
			
			text = await asyncio.to_thread(whisper.transcribe, audio, "en")
			return Response(content=(text or ""), media_type="text/plain")
		except Exception as e:
			# Surface the error for easier debugging instead of generic 500
			return JSONResponse({"ok": False, "error": "listen_failed", "detail": str(e), "error": str(e)}, status_code=500)
		finally:
			# Resume waiting audio after recording is complete
			resume_waiting_audio()
	finally:
		unregister_operation(operation_id)


@app.post("/record")
async def record(payload: dict = Body(...)):
	# Accepts {"maxInitialSilence": number, "maxTailSilence": number}
	try:
		max_initial = int(payload.get("maxInitialSilence", 0))
		max_tail = int(payload.get("maxTailSilence", 0))
	except Exception:
		return JSONResponse({"ok": False, "error": "Invalid parameters"}, status_code=400)
	
	operation_id = f"record_{id(payload)}"
	register_operation(operation_id)
	
	try:
		# Check if we're shutting down
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		# Pause waiting audio during recording to prevent interference
		pause_waiting_audio()
		
		# Capture and encode to WAV
		import io as _io, wave as _wave, numpy as _np
		audio = await asyncio.to_thread(microphone.capture, max_initial, max_tail, shutdown_event=_shutdown_event)
		
		# Check again after capture
		if _shutdown_event.is_set():
			return JSONResponse({"ok": False, "error": "Speech server is shutting down"}, status_code=503)
		
		buf = _io.BytesIO()
		with _wave.open(buf, "wb") as wf:
			wf.setnchannels(1)
			wf.setsampwidth(2)
			wf.setframerate(16000)
			wf.writeframes((_np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes())
		data = buf.getvalue()
		return Response(content=data, media_type="audio/wav")
	finally:
		# Resume waiting audio after recording is complete
		resume_waiting_audio()
		unregister_operation(operation_id)


def parse_args():
	p = argparse.ArgumentParser()
	# Allow overriding port via env var SPEECH_PORT
	default_port = int(os.getenv("SPEECH_PORT", "8009"))
	p.add_argument("--port", type=int, default=default_port)
	p.add_argument("--model_dir", type=str, default="/workspace/models/xtts_v2", help="Local dir for XTTS model snapshot")
	p.add_argument("--output-device", type=int, default=None, help="ALSA device index for playback")
	return p.parse_args()


def main():
	args = parse_args()
	# Configure speaker output device if provided
	out_dev_env = os.getenv("SPEECH_DEVICE")
	if out_dev_env is not None:
		# allow numeric indices or string names
		out_dev = None
		try:
			out_dev = int(out_dev_env)
		except Exception:
			out_dev = out_dev_env
		speaker.configure(output_device=out_dev)
	else:
		speaker.configure(output_device=args.output_device)

	import uvicorn
	uvicorn.run(
		app,
		host="0.0.0.0",
		port=args.port,
		log_level="info",
	)


if __name__ == "__main__":
	main()