#!/usr/bin/env bash
# Demo: `otterpack up` on a private tmux socket with the fake harnesses from
# cli/test/fake (no real claude or codex, no tokens). Shows first launch with kickoff,
# --dry-run, a seat that exits and is relaunched on the same conversation, the Codex
# conversation found by its marker, a TEAM_TMUX_SOCKET rehearsal, and the management
# commands: status, stop, reset, disable, enable, add and remove.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
sock="otterpack-test-demo-$$"
cleanup() { tmux -L "$sock" kill-server 2>/dev/null || true; tmux -L "$sock-rehearsal" kill-server 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

export HOME="$work/home" SHELL=/bin/bash FAKE_LOG="$work/runs.jsonl" OTTERPACK_TMUX_SOCKET="$sock"
unset TMUX TEAM_TMUX_SOCKET
mkdir -p "$HOME"
export PATH="$repo/cli/test/fake:$PATH"
printf 'export PATH=%q:"$PATH"\n' "$repo/cli/test/fake" > "$HOME/.bash_profile"   # tmux runs login shells

lib="$work/lib"   # a throwaway library repo next to the project (team.yaml: library: ../lib)
mkdir -p "$lib/library/personas" && echo "# PO" > "$lib/library/personas/product-owner.md" && echo "# DevSecOps" > "$lib/library/personas/devsecops.md"
git -C "$lib" init -q -b main && git -C "$lib" add -A && git -C "$lib" -c user.name=demo -c user.email=demo@example.com commit -q -m library

proj="$work/demo"
mkdir -p "$proj/.otterpack"
cat > "$proj/.otterpack/team.yaml" <<'YAML'
name: demo
library: ../lib
kits: []
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
    persona: devsecops
    harness: codex
YAML
cd "$proj"
at() { node "$repo/cli/dist/index.js" "$@"; }
runs() { node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n")) { const r=JSON.parse(l); console.log("   ", r.name, JSON.stringify(r.args)); }' "$FAKE_LOG"; }

echo "== up before any sync refuses (the seats would miss their personas and tasks)"
at up --no-attach || true
echo
echo "== otterpack sync"
at sync | head -1
echo
echo "== otterpack up --no-attach (first launch: kickoff passed as the prompt)"
at up --no-attach
sleep 3
runs
echo
echo "== otterpack up --dry-run"
at up --dry-run
echo
echo "== .otterpack/state/sessions/ (Claude id chosen up front, Codex id found by its marker)"
for f in .otterpack/state/sessions/*.json; do echo "   $(basename "$f"): $(tr -d "\n " < "$f")"; done
echo
echo "== the PO harness exits; the seat is a bare shell; up relaunches it, resuming"
tmux -L "$sock" send-keys -t =claude-po: C-c   # quit the harness, as a person would
sleep 1
at up claude-po --no-attach
sleep 2
runs | tail -1
echo
echo "== rehearsal: TEAM_TMUX_SOCKET types the launch as a no-op"
TEAM_TMUX_SOCKET="$sock-rehearsal" at up claude-po --no-attach
sleep 1
tmux -L "$sock-rehearsal" capture-pane -p -J -t =claude-po: | grep -m1 ': ' | cut -c1-100
echo
echo "== otterpack status"
at status
echo
echo "== otterpack stop codex-re (conversation kept), then status"
at stop codex-re
at status | grep codex-re
echo
echo "== otterpack reset claude-po (conversation forgotten)"
at reset claude-po
echo
echo "== otterpack add claude-ux --persona none --label UX, then remove it"
at add claude-ux --persona none --label UX | tail -1
grep -c '"label": "UX"' .vscode/tasks.json | sed 's/^/   UX tasks in tasks.json: /'
at remove claude-ux | tail -1
grep -c '"label": "UX"' .vscode/tasks.json | sed 's/^/   UX tasks in tasks.json: /' || true
echo
echo "== otterpack disable codex-re: no task, up skips it; enable brings it back"
at disable codex-re
grep -c '"label": "DevSecOps"' .vscode/tasks.json | sed 's/^/   DevSecOps tasks in tasks.json: /' || true
at up --no-attach | grep codex-re
at enable codex-re
grep -c '"label": "DevSecOps"' .vscode/tasks.json | sed 's/^/   DevSecOps tasks in tasks.json: /'
