#!/usr/bin/env bash
# Explicit mirror download for the bundled multilingual Medium Q5 model.
# Preserve TLS verification; pin the same SHA-256 reported by both repositories.
set -euo pipefail
MODEL_DIR="$HOME/Library/Application Support/com.miraphant.voice-memory/models"
MODEL_PATH="$MODEL_DIR/ggml-medium-q5_0.bin"
EXPECTED="19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f"
URL="https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-medium-q5_0.bin"
hash_of() { shasum -a 256 "$1" | awk '{print $1}'; }
if [[ -e "$MODEL_PATH" ]]; then
  [[ -f "$MODEL_PATH" && ! -L "$MODEL_PATH" ]] || { echo "error: unexpected model target" >&2; exit 1; }
  [[ "$(hash_of "$MODEL_PATH")" == "$EXPECTED" ]] || { echo "error: existing model checksum differs; left untouched" >&2; exit 1; }
  echo "Verified installed model: $MODEL_PATH"
  exit 0
fi
if [[ "${1:-}" == "--check" ]]; then echo "Model not installed" >&2; exit 1; fi
[[ $# == 0 ]] || { echo "usage: $0 [--check]" >&2; exit 2; }
mkdir -p "$MODEL_DIR"
MODEL_TEMP=$(mktemp "$MODEL_DIR/.medium-q5-download.XXXXXX")
trap '[[ ! -f "$MODEL_TEMP" ]] || rm -f "$MODEL_TEMP"' EXIT
curl --fail --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 900 --retry 2 --output "$MODEL_TEMP" "$URL"
[[ "$(hash_of "$MODEL_TEMP")" == "$EXPECTED" ]] || { echo "error: downloaded checksum mismatch" >&2; exit 1; }
# Link in the same directory is atomic and fails if another process installed it.
ln "$MODEL_TEMP" "$MODEL_PATH"
echo "Installed verified model: $MODEL_PATH"
echo "Choose Settings > Transcription > Model > Medium (quantized)."
