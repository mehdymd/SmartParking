#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_PATH="$ROOT_DIR/backend/settings.json"
TUNNEL_TARGET="${TUNNEL_TARGET:-http://127.0.0.1:3000}"
LOG_FILE="${TMPDIR:-/tmp}/smartparking-cloudflared.log"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Install it first, for example: brew install cloudflared" >&2
  exit 1
fi

rm -f "$LOG_FILE"
touch "$LOG_FILE"

cleanup() {
  if [[ -n "${CLOUDFLARED_PID:-}" ]]; then
    kill "$CLOUDFLARED_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Cloudflare tunnel for $TUNNEL_TARGET"
cloudflared tunnel --url "$TUNNEL_TARGET" --no-autoupdate >"$LOG_FILE" 2>&1 &
CLOUDFLARED_PID=$!

PORTAL_URL=""
for _ in {1..40}; do
  if ! kill -0 "$CLOUDFLARED_PID" >/dev/null 2>&1; then
    echo "cloudflared exited before publishing a URL:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi

  PORTAL_URL="$(python3 - <<'PY' "$LOG_FILE"
import re
import sys
from pathlib import Path

log_path = Path(sys.argv[1])
text = log_path.read_text(encoding="utf-8", errors="ignore")
match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", text)
print(match.group(0) if match else "")
PY
)"

  if [[ -n "$PORTAL_URL" ]]; then
    break
  fi

  sleep 1
done

if [[ -z "$PORTAL_URL" ]]; then
  echo "Cloudflare tunnel URL was not detected. Current log:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

PORTAL_URL="${PORTAL_URL%/}/?portal=access"

python3 - <<'PY' "$SETTINGS_PATH" "$PORTAL_URL"
import json
import sys
from pathlib import Path

settings_path = Path(sys.argv[1])
portal_url = sys.argv[2]
data = json.loads(settings_path.read_text(encoding="utf-8"))
data["access_portal_url"] = portal_url
settings_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(portal_url)
PY

echo
echo "Portal URL saved to backend/settings.json:"
echo "$PORTAL_URL"
echo
echo "cloudflared is running in the background for this shell session."
echo "Press Ctrl+C here to stop the tunnel."
echo

tail -f "$LOG_FILE"
