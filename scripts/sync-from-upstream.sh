#!/usr/bin/env bash
# sync-from-upstream.sh — single-source maintenance for the two-repo split.
#
# Repo A (Codex skill) is the source of truth for the ENGINE (SKILL.md,
# reference/, server/, specs/). Repo B must carry a VERBATIM copy so there is
# never a second implementation to maintain. This script re-syncs the copy,
# proves it byte-identical, then runs BOTH test suites:
#   - Repo B wrapper smoke (A skills / B discovery / C daemon+tools / D client)
#   - Repo A server self-test (24 checks)
#
# Usage: scripts/sync-from-upstream.sh [upstream-skill-dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
UPSTREAM="${1:-/Users/admin/Documents/ClueGo/.agents/skills/canvas-design-harness}"
DEST="$REPO/.agents/skills/canvas-design-harness"

if [ ! -f "$UPSTREAM/SKILL.md" ]; then
  echo "error: upstream skill not found: $UPSTREAM" >&2
  exit 2
fi

cp -R "$UPSTREAM"/SKILL.md "$UPSTREAM"/reference "$UPSTREAM"/server "$UPSTREAM"/specs "$UPSTREAM"/.gitignore "$DEST"/

if diff -r --exclude=".DS_Store" "$UPSTREAM" "$DEST" >/dev/null; then
  echo "VERBATIM-OK (skill copy byte-identical to upstream)"
else
  echo "error: copy diverged from upstream after sync" >&2
  exit 1
fi

echo "== Repo B wrapper smoke (A/B/C/D) =="
node "$REPO/test/smoke.mjs"

echo "== Repo A server self-test =="
(cd "$DEST/server" && node test/smoke.js)

echo "sync complete"
