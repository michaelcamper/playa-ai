import os
import sys
import shutil
from pathlib import Path

try:
	from huggingface_hub import hf_hub_download
except Exception as exc:
	print(f"[download_model] missing dependency huggingface_hub: {exc}", file=sys.stderr)
	sys.exit(2)


def main() -> None:
	model_file = os.getenv("LLM_MODEL_FILE")
	if not model_file:
		print("LLM_MODEL_FILE is required", file=sys.stderr)
		sys.exit(2)

	repo = os.getenv("LLM_HF_REPO")
	if not repo:
		print("LLM_HF_REPO is required", file=sys.stderr)
		sys.exit(2)

	token = os.getenv("HUGGINGFACE_TOKEN")
	print(f"[download_model] downloading {repo}:{model_file}")
	path = hf_hub_download(repo_id=repo, filename=model_file, token=token)
	dst = Path("/models") / model_file
	dst.parent.mkdir(parents=True, exist_ok=True)
	if not dst.exists():
		shutil.copy2(path, dst)
	print(f"[download_model] saved {dst}")


if __name__ == "__main__":
	main()
