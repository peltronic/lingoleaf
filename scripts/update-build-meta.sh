#!/usr/bin/env bash
# Writes extension/build-meta.json with the current git commit (short).
# Run from repo root: ./scripts/update-build-meta.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/extension/build-meta.json"

if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
  if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
    COMMIT="${COMMIT}-dirty"
  fi
else
  COMMIT="unknown"
fi

printf '%s\n' "{\"commit\":\"${COMMIT}\"}" >"$OUT"
echo "Wrote $OUT (commit=${COMMIT})"
