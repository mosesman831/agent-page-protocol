#!/usr/bin/env bash
# §9.2 harness gate: serves the repo root on :8765 (or 8775 if :8765 is owned
# by a foreign server), runs every vector in both mounts, prints PASS/FAIL
# lines, exits non-zero if any FAIL or missing output.
#
#   ./extension/.harness/run.sh           # verdicts
#
# For human-verifiable screenshots (headless --screenshot captures before
# first paint under virtual-time, so it is NOT reliable), use playwright:
#   playwright screenshot --viewport-size 960,1080 --wait-for-selector .app-card \
#     "http://127.0.0.1:8775/extension/.harness/index.html?v=V-SKIN-1" /tmp/v1.png
# (shots/ in this dir holds a captured set; PORT env var overrides the port.)
#
set -u
cd "$(dirname "$0")/../.." || exit 2
PORT="${PORT:-8765}"
# If $PORT is owned by something that doesn't serve this repo, fall back.
if curl -sf -o /dev/null "http://127.0.0.1:$PORT/" \
  && ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/extension/manifest.json"; then
  PORT=8775
fi
BASE="http://127.0.0.1:$PORT/extension/.harness/index.html"
CH="${CH:-$(command -v chromium || command -v chromium-browser || echo /snap/bin/chromium)}"
CHFLAGS=(--headless --disable-gpu --no-first-run --no-sandbox --window-size=960,1080 --virtual-time-budget=6000)
VECTORS="V-SKIN-1 V-SKIN-2 V-SKIN-3 V-SKIN-4 V-SKIN-5 V-SKIN-6 V-SKIN-C"

if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/skin-harness-server.log 2>&1 &
  SRV=$!
  trap 'kill $SRV 2>/dev/null' EXIT
  sleep 1
fi

fail=0
run() { # $1=query $2=label $3...=extra chromium flags
  local q="$1" label="$2"; shift 2
  local out i
  for i in 1 2 3; do
    out=$("$CH" "${CHFLAGS[@]}" "$@" --dump-dom "$BASE?$q" 2>/dev/null | grep -oE '(PASS|FAIL) [^<]+')
    [ -n "$out" ] && break
  done
  echo "--- $label"
  if [ -z "$out" ]; then
    echo "FAIL $label no harness output"
    fail=1
  else
    echo "$out"
    echo "$out" | grep -q '^FAIL' && fail=1
  fi
}

for v in $VECTORS; do
  run "v=$v" "$v"
  run "v=$v&shadow=1" "$v shadow"
done
# reduced-motion variants
run "v=V-SKIN-5&rm=1" "V-SKIN-5 reduced" --force-prefers-reduced-motion
run "v=V-SKIN-4&rm=1" "V-SKIN-4 reduced" --force-prefers-reduced-motion

exit $fail
