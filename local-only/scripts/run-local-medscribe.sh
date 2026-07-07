#!/usr/bin/env bash
set -euo pipefail

AUDIO_PATH="${1:-}"
if [[ -z "$AUDIO_PATH" ]]; then
  echo "Usage: $0 /path/to/audio.wav"
  exit 1
fi

cd /Users/engageo/EngageoScribe
. .venv-med/bin/activate

python /Users/engageo/EngageoScribe/scripts/local_medscribe.py \
  --audio "$AUDIO_PATH"
