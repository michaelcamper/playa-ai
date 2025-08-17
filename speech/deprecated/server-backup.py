import argparse
import os

from fastapi import FastAPI, Body, Header
from fastapi.responses import JSONResponse
import asyncio
from contextlib import asynccontextmanager

try:
	from . import xtts_engine
except Exception:
	# Fallback when running as a script without package context
	import sys
	sys.path.append(os.path.dirname(__file__))
	import xtts_engine  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
	# Initialize XTTS when the app starts
	model_dir = os.getenv("MODEL_DIR", "/workspace/models/xtts_v2")
	try:
		xtts_engine.initialize_xtts(model_dir=model_dir)
	except Exception as e:
		print(f"[speech] startup init failed: {e}", flush=True)
	yield

app = FastAPI(lifespan=lifespan)




@app.get("/health")
def health():
	return {
		"status": "ok",
		"device": "cuda",
		"sample_rate": xtts_engine.get_sample_rate(),
		"blocksize": xtts_engine.get_blocksize(),
	}

@app.post("/speak")
async def speak(raw_bytes: bytes = Body(...), content_type: str | None = Header(default=None, alias="content-type")):
	# Accept plain text body, JSON string, or JSON object {"text": ...}
	content_type = (content_type or "").lower()
	decoded = raw_bytes.decode("utf-8", "ignore").strip()
	text = ""
	if "application/json" in content_type:
		import json
		try:
			obj = json.loads(decoded)
			if isinstance(obj, str):
				text = obj.strip()
			elif isinstance(obj, dict):
				text = (obj.get("text") or "").strip()
		except Exception:
			text = decoded
	elif "text/plain" in content_type or not content_type:
		text = decoded
	else:
		# try JSON, fallback to raw
		import json
		try:
			obj = json.loads(decoded)
			if isinstance(obj, str):
				text = obj.strip()
			elif isinstance(obj, dict):
				text = (obj.get("text") or "").strip()
		except Exception:
			text = decoded

	if not text:
		return JSONResponse({"error": "text is required"}, status_code=400)

	return await asyncio.to_thread(xtts_engine.speak, text)

@app.post("/play_speaker")
async def play_speaker():
	# Plays DEFAULT_SPEAKER_WAV through the same audio pipeline to isolate audio path issues
	return await asyncio.to_thread(xtts_engine.play_speaker_wav)


@app.post("/audio/start")
async def audio_start():
	return await asyncio.to_thread(xtts_engine.start_output_stream)


@app.post("/audio/stop")
async def audio_stop():
	return await asyncio.to_thread(xtts_engine.stop_output_stream)


@app.post("/play_wav")
async def play_wav(raw_bytes: bytes = Body(...), content_type: str | None = Header(default=None, alias="content-type")):
	# Accept JSON {"path": "/path/to.wav"}
	import json
	try:
		payload = json.loads(raw_bytes.decode("utf-8", "ignore"))
		path = (payload.get("path") or "").strip()
	except Exception:
		return JSONResponse({"error": "Invalid JSON"}, status_code=400)
	if not path:
		return JSONResponse({"error": "path is required"}, status_code=400)
	return await asyncio.to_thread(xtts_engine.play_wav_once, path)



def parse_args():
	p = argparse.ArgumentParser()
	# Allow overriding port via env var PORT
	default_port = int(os.getenv("PORT", "8009"))
	p.add_argument("--port", type=int, default=default_port)
	p.add_argument("--model_dir", type=str, default="/workspace/models/xtts_v2", help="Local dir for XTTS model snapshot")
	p.add_argument("--output-device", type=int, default=None, help="ALSA device index for playback")
	return p.parse_args()




def main():
	args = parse_args()
	xtts_engine.set_output_device_index(args.output_device)

	print("Starting speech server")
	print(args)

	import uvicorn
	# Enable hot reload if requested (requires watchfiles in the image)
	reload_enabled = os.getenv("DEV_RELOAD", "0") in ("1", "true", "TRUE", "yes", "on")
	if reload_enabled:
		# Use import string so uvicorn can reload properly
		uvicorn.run(
			"speech.server:app",
			host="0.0.0.0",
			port=args.port,
			log_level="info",
			reload=True,
			reload_dirs=["/workspace/speech"],
		)
	else:
		uvicorn.run(
			app,
			host="0.0.0.0",
			port=args.port,
			log_level="info",
		)


if __name__ == "__main__":
	main()