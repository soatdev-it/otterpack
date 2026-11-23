import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { parseTeam } from "../src/config.ts";
import { launchArgv, findClaudeTranscript, findCodexRollout } from "../src/harness.ts";
import { fakeHome } from "./helpers.ts";

const team = parseTeam(`name: p
library: ../lib
kits: []
seats:
  - id: claude-ar
    label: Architect
    icon: compass
    color: ansiBrightCyan
    persona: architect
    harness: claude
    args: [--model, opus]
  - id: codex-re
    label: DevSecOps
    icon: shield
    color: ansiBrightRed
    persona: devsecops
    harness: codex
    args: [--model, gpt-5]
  - id: claude-copy
    label: Copywriter
    icon: globe
    color: ansiBrightMagenta
    persona: none
    harness: claude
    cwd: drafts
    launcher: .otterpack/local/copywriter-launch.sh
  - id: codex-au
    label: Audit
    icon: law
    color: ansiBrightYellow
    persona: none
    harness: codex
    launcher: .otterpack/local/codex-launch.sh
`, "/w");
const [ar, re, copy, au] = team.seats;

test("claude first launch: fixed session id, name, kickoff as the prompt", () => {
  assert.deepEqual(launchArgv(ar, "/w", { kind: "first", id: "U1", kickoff: "hi" }), {
    cmd: "claude", args: ["--model", "opus", "--name", "Architect", "--session-id", "U1", "hi"],
  });
});

test("claude resume", () => {
  assert.deepEqual(launchArgv(ar, "/w", { kind: "resume", id: "U1" }), {
    cmd: "claude", args: ["--model", "opus", "--name", "Architect", "--resume", "U1"],
  });
});

test("codex first launch: update check off, kickoff as the prompt", () => {
  assert.deepEqual(launchArgv(re, "/w", { kind: "first", kickoff: "hi" }), {
    cmd: "codex", args: ["-c", "check_for_update_on_startup=false", "--model", "gpt-5", "hi"],
  });
});

test("codex resume: options after `resume`, then the id", () => {
  assert.deepEqual(launchArgv(re, "/w", { kind: "resume", id: "C1" }), {
    cmd: "codex", args: ["resume", "-c", "check_for_update_on_startup=false", "--model", "gpt-5", "C1"],
  });
});

test("a launcher script gets the seat's args, the conversation id and --name", () => {
  assert.deepEqual(launchArgv(copy, "/w", { kind: "resume", id: "U2" }), {
    cmd: "/w/.otterpack/local/copywriter-launch.sh", args: ["--resume", "U2", "--name", "Copywriter"],
  });
  assert.deepEqual(launchArgv(copy, "/w", { kind: "first", id: "U3" }), {
    cmd: "/w/.otterpack/local/copywriter-launch.sh", args: ["--session-id", "U3", "--name", "Copywriter"],
  });
  assert.deepEqual(launchArgv(au, "/w", { kind: "resume", id: "C2" }), {
    cmd: "/w/.otterpack/local/codex-launch.sh", args: ["--resume", "C2", "--name", "Audit"],
  });
});

test("finds a Claude transcript by id in any project folder", () => {
  const home = fakeHome();
  assert.equal(findClaudeTranscript(home, "abc"), undefined);
  mkdirSync(join(home, ".claude/projects/-w-drafts"), { recursive: true });
  writeFileSync(join(home, ".claude/projects/-w-drafts/abc.jsonl"), "{}\n");
  assert.equal(findClaudeTranscript(home, "abc"), join(home, ".claude/projects/-w-drafts/abc.jsonl"));
});

function rollout(home: string, day: string[], id: string, cwd: string, lines: string[], mtime?: Date): string {
  const dir = join(home, ".codex/sessions", ...day);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-x-${id}.jsonl`);
  writeFileSync(f, [JSON.stringify({ type: "session_meta", payload: { id, cwd } }), ...lines].join("\n") + "\n");
  if (mtime) utimesSync(f, mtime, mtime);
  return f;
}

test("finds the Codex rollout with the seat cwd and the marker", () => {
  const home = fakeHome();
  const since = Date.now() - 1000;
  rollout(home, ["2026", "11", "10"], "other-cwd", "/elsewhere", ["[seat:p/codex-re] hi"]);
  rollout(home, ["2026", "11", "10"], "no-marker", "/w", ["hello"]);
  rollout(home, ["2026", "11", "09"], "too-old", "/w", ["[seat:p/codex-re] hi"], new Date(since - 60_000));
  assert.equal(findCodexRollout(home, "/w", "[seat:p/codex-re]", since), undefined);
  rollout(home, ["2026", "11", "10"], "the-one", "/w", ["[seat:p/codex-re] hi"]);
  assert.equal(findCodexRollout(home, "/w", "[seat:p/codex-re]", since), "the-one");
});

test("no ~/.codex/sessions folder is not an error", () => {
  assert.equal(findCodexRollout(fakeHome(), "/w", "[seat:p/x]", 0), undefined);
});

test("a seat in a subfolder gets its seat folder as an extra writable dir (it lives outside its cwd)", () => {
  const sub = parseTeam(`library: x
seats:
  - id: claude-web
    label: Web
    icon: code
    color: ansiGreen
    persona: none
    harness: claude
    cwd: apps/web
  - id: codex-web
    label: Web codex
    icon: code
    color: ansiGreen
    persona: none
    harness: codex
    cwd: apps/web
`, "/w");
  const [c, x] = sub.seats;
  assert.deepEqual(launchArgv(c, "/w", { kind: "first", id: "U1" }).args, ["--add-dir", "/w/.otterpack/seats/claude-web", "--name", "Web", "--session-id", "U1"]);
  assert.deepEqual(launchArgv(c, "/w", { kind: "resume", id: "U1" }).args, ["--add-dir", "/w/.otterpack/seats/claude-web", "--name", "Web", "--resume", "U1"]);
  assert.deepEqual(launchArgv(x, "/w", { kind: "first" }).args, ["-c", "check_for_update_on_startup=false", "--add-dir", "/w/.otterpack/seats/codex-web"]);
  assert.deepEqual(launchArgv(x, "/w", { kind: "resume", id: "R1" }).args, ["resume", "-c", "check_for_update_on_startup=false", "--add-dir", "/w/.otterpack/seats/codex-web", "R1"]);
});

test("a resume can carry a prompt (the re-brief): last, after the id", () => {
  const ar = team.seats[0];
  const re = team.seats[1];
  assert.deepEqual(launchArgv(ar, "/w", { kind: "resume", id: "U1", prompt: "again" }).args.slice(-3), ["--resume", "U1", "again"]);
  assert.deepEqual(launchArgv(re, "/w", { kind: "resume", id: "C1", prompt: "again" }).args.slice(-2), ["C1", "again"]);
  assert.deepEqual(launchArgv(copy, "/w", { kind: "resume", id: "U2", prompt: "again" }).args.slice(-1), ["again"]);
});
