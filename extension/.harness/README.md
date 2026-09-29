# Skin harness

Headless verification for docs/specs/SPEC-renderer-skin-DRAFT.md §9.2. Plain ES modules, no
dependencies — a static page mounts `AppRenderer` over fixture manifests and
emits `PASS`/`FAIL` lines.

```bash
./extension/.harness/run.sh        # all vectors, both mounts, exit code = verdict
```

Screenshots: headless `--screenshot` captures before first paint under
virtual-time, so it does NOT produce useful shots. `shots/` holds a set
captured via playwright (see the comment at the top of run.sh for the recipe).

Manually:

```bash
python3 -m http.server 8765 &   # serve repo root (any free port; fixture :8765 URLs are rewritten to the serving origin)
chromium --headless --disable-gpu --no-first-run \
  --window-size=960,1080 --virtual-time-budget=6000 \
  --dump-dom 'http://127.0.0.1:8765/extension/.harness/index.html?v=V-SKIN-1' \
  | grep -oE '(PASS|FAIL) [^<]+'
```

Params: `v=V-SKIN-1..6|V-SKIN-C`, `&shadow=1` (closed-shadow mount),
`&rm=class` (settings reducedMotion) or `&rm=1` (use with
`--force-prefers-reduced-motion`), `&stage=before` (V-SKIN-5 unpaid state).
