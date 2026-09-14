#!/usr/bin/env bash
# Serve this folder on localhost so the camera scanner works
# (browsers refuse camera access to file:// pages).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
echo "QR Converter -> http://localhost:$PORT"
exec python3 -m http.server "$PORT"
