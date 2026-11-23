#!/usr/bin/env bash
# Demo: `update` moves the pin and shows what changes; `doctor` checks the
# container. doctor runs the real CLIs only for status commands (claude auth status,
# codex login status, codex sandbox -- true): no conversation, no tokens.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
at() { node "$repo/cli/dist/index.js" "$@"; }
c() { git -C "$lib" -c user.name=demo -c user.email=demo@example.com commit -q -m "$1"; }

lib="$work/library-repo"; mkdir -p "$lib/library/personas" "$lib/library/kits/core/agents"
echo "# PO v1" > "$lib/library/personas/product-owner.md"
echo "planner" > "$lib/library/kits/core/agents/planner.md"
echo "old" > "$lib/library/kits/core/agents/old-agent.md"
git -C "$lib" init -q -b main && git -C "$lib" add -A && c "library v1"

proj="$work/proj"; mkdir -p "$proj/.otterpack"; cd "$proj"
cat > .otterpack/team.yaml <<YAML
library: $lib
kits: [core]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
  - id: codex-re
    label: DevSecOps
    icon: shield
    color: ansiBrightRed
    persona: none
    harness: codex
YAML
at sync | head -1
echo
echo "== the library moves on: a persona edit and an agent removed"
echo "# PO v2" > "$lib/library/personas/product-owner.md"; git -C "$lib" add -A; c "PO persona: v2"
git -C "$lib" rm -q library/kits/core/agents/old-agent.md; c "drop old-agent"
echo
echo "== otterpack update"
at update
echo
echo "== otterpack update again"
at update
echo
echo "== otterpack doctor (real tmux, git, claude and codex status commands)"
at doctor || echo "(doctor exit $?)"
