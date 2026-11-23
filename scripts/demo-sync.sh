#!/usr/bin/env bash
# Demo: sync the 13-seat test team into a scratch project, compare tasks.json with the
# golden file, sync again (writes nothing), then show sync refusing a hand-made file.
# Runs entirely in a temp folder: no tmux, no harness, nothing outside $TMPDIR.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
export HOME="$work/home"; mkdir -p "$HOME"

# A tiny library repo with one kit and one persona.
lib="$work/library-repo"
mkdir -p "$lib/library/kits/core/skills/handoff" "$lib/library/kits/core/agents" "$lib/library/personas"
printf -- '---\nname: handoff\n---\nHand work to another seat.\n' > "$lib/library/kits/core/skills/handoff/SKILL.md"
printf -- '---\nname: planner\n---\nPlan the work.\n' > "$lib/library/kits/core/agents/planner.md"
git -C "$lib" init -q -b main && git -C "$lib" add -A
git -C "$lib" -c user.name=demo -c user.email=demo@example.com commit -q -m library

proj="$work/acme"
mkdir -p "$proj/.otterpack"
sed "s#^library: .*#library: $lib#; s#^kits: \[\]#kits: [core]#" "$repo/cli/test/fixtures/team/team.yaml" > "$proj/.otterpack/team.yaml"

cd "$proj"
node "$repo/cli/dist/index.js" sync
echo
echo "== tasks.json vs the golden file:"
if diff .vscode/tasks.json "$repo/cli/test/fixtures/team/tasks.json" >/dev/null; then echo "identical"; else echo "DIFFERENT"; exit 1; fi
echo
echo "== second sync (must write nothing):"
node "$repo/cli/dist/index.js" sync
echo
echo "== a fresh project with a hand-made agent of the same name (sync must stop):"
proj2="$work/fresh"
mkdir -p "$proj2/.otterpack" "$proj2/.claude/agents"
cp "$proj/.otterpack/team.yaml" "$proj2/.otterpack/team.yaml"
echo hand-made > "$proj2/.claude/agents/planner.md"
cd "$proj2"
node "$repo/cli/dist/index.js" sync || echo "(exit $? as expected; .claude/agents/planner.md untouched: $(cat .claude/agents/planner.md))"
rm -rf "$work"
