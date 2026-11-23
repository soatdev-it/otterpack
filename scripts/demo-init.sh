#!/usr/bin/env bash
# Demo: a new project from nothing. init from the web-team template using this repo's
# library/ (copied into a temp git repo, so uncommitted edits show too), then sync, then
# count what the project got. No tmux, no harness, all in a temp folder.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
export HOME="$work/home"; mkdir -p "$HOME"
lib="$work/library-repo"; mkdir -p "$lib"; cp -r "$repo/library" "$lib/"
git -C "$lib" init -q -b main && git -C "$lib" add -A && git -C "$lib" -c user.name=demo -c user.email=demo@example.com commit -q -m library
proj="$work/my-site"; mkdir -p "$proj"; cd "$proj"
start=$(date +%s)
node "$repo/cli/dist/index.js" init --library "$lib"
node "$repo/cli/dist/index.js" sync | head -1
echo
echo "== seats"
grep -E '^  - id:|label:' .otterpack/team.yaml | paste - - | sed 's/  */ /g'
echo
agents=$(ls .claude/agents | wc -l); skills=$(ls .agents/skills | wc -l)
echo "== counts: $agents agents (target <= 15), $skills skills (target <= 45)"
diff <(ls .agents/skills) <(ls .claude/skills) >/dev/null && echo "   .agents/skills and .claude/skills list the same names"
echo
echo "== kickoff for the first seat (Product)"
node --input-type=module -e "
  const { loadTeam } = await import('$repo/cli/dist/config.js');
  const { renderKickoff } = await import('$repo/cli/dist/kickoff.js');
  const t = loadTeam(process.cwd()); console.log(renderKickoff(t, t.seats[0], process.cwd()));"
echo
echo "== init to synced team: $(( $(date +%s) - start )) s"
