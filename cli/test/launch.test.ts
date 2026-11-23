// launch: the process typed into a seat's shell. Runs the (fake) harness in the foreground
// and records the conversation id. No tmux here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../src/launch.ts";
import { loadSessions, setSession } from "../src/sessions.ts";
import { project, fakeHome, tmp, writeFiles } from "./helpers.ts";

const FAKE = fileURLToPath(new URL("./fake", import.meta.url));

const TEAM = `name: demo
library: ../lib
charter: CHARTER.md
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
  - id: claude-copy
    label: Copywriter
    icon: globe
    color: ansiBrightMagenta
    persona: none
    harness: claude
    cwd: drafts
    launcher: .otterpack/local/copy.sh
`;

function env(home: string, log: string, extra: Record<string, string> = {}) {
  return { ...process.env, HOME: home, PATH: `${FAKE}:${process.env.PATH}`, FAKE_LOG: log, FAKE_EXIT: "0", ...extra };
}

function setup() {
  const root = project(TEAM, { "drafts/.keep": "", ".otterpack/personas/product-owner.md": "po\n", ".otterpack/personas/devsecops.md": "d\n" });
  const home = fakeHome();
  const log = join(tmp(), "log.jsonl");
  return { root, home, log };
}

const runs = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("claude first launch: new id, kickoff as the prompt, recorded and confirmed", async () => {
  const { root, home, log } = setup();
  assert.equal(await launch(root, "claude-po", { env: env(home, log) }), 0);
  const [run] = runs(log);
  assert.equal(run.name, "claude");
  assert.equal(run.cwd, root);
  const id = run.args[run.args.indexOf("--session-id") + 1];
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.match(run.args.at(-1), /^\[seat:demo\/claude-po\] You are PO on this team/);
  const { brief, ...entry } = loadSessions(root)["claude-po"];
  assert.deepEqual(entry, { harness: "claude", id, confirmed: true });
  assert.equal(brief?.persona, "product-owner");
});

test("claude second launch resumes the same conversation, without a kickoff", async () => {
  const { root, home, log } = setup();
  await launch(root, "claude-po", { env: env(home, log) });
  await launch(root, "claude-po", { env: env(home, log) });
  const [first, second] = runs(log);
  const id = first.args[first.args.indexOf("--session-id") + 1];
  assert.deepEqual(second.args, ["--name", "PO", "--resume", id]);
});

test("a recorded conversation whose transcript is gone stops; no new conversation", async () => {
  const { root, home, log } = setup();
  setSession(root, "claude-po", { harness: "claude", id: "gone-id", confirmed: true });
  const errors: string[] = [];
  const code = await launch(root, "claude-po", { env: env(home, log), stderr: (s) => errors.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(runs(log), []);
  assert.match(errors.join(""), /gone-id.*not found/s);
  assert.match(errors.join(""), /sessions\/claude-po\.json/);
});

test("an unconfirmed id (first launch never got going) is launched again as a first launch", async () => {
  const { root, home, log } = setup();
  setSession(root, "claude-po", { harness: "claude", id: "11111111-1111-1111-1111-111111111111", confirmed: false });
  await launch(root, "claude-po", { env: env(home, log) });
  const [run] = runs(log);
  assert.equal(run.args[run.args.indexOf("--session-id") + 1], "11111111-1111-1111-1111-111111111111");
  assert.equal(loadSessions(root)["claude-po"].confirmed, true);
});

test("codex first launch: kickoff as the prompt, id found by marker in its rollout", async () => {
  const { root, home, log } = setup();
  assert.equal(await launch(root, "codex-re", { env: env(home, log, { FAKE_CODEX_DELAY_MS: "200" }) }), 0);
  const [run] = runs(log);
  assert.equal(run.name, "codex");
  assert.match(run.args.at(-1), /^\[seat:demo\/codex-re\]/);
  const s = loadSessions(root)["codex-re"];
  assert.equal(s.harness, "codex");
  assert.match(s.id, /^[0-9a-f-]{36}$/);
});

test("codex resume uses the recorded id", async () => {
  const { root, home, log } = setup();
  setSession(root, "codex-re", { harness: "codex", id: "C1", confirmed: true });
  await launch(root, "codex-re", { env: env(home, log) });
  assert.deepEqual(runs(log)[0].args, ["resume", "-c", "check_for_update_on_startup=false", "C1"]);
});

test("a launcher seat runs the project script in its cwd, with no kickoff", async () => {
  const { root, home, log } = setup();
  writeFiles(root, { ".otterpack/local/copy.sh": `#!/bin/sh\nexec claude --restricted "$@"\n` });
  chmodSync(join(root, ".otterpack/local/copy.sh"), 0o755);
  await launch(root, "claude-copy", { env: env(home, log) });
  const [run] = runs(log);
  assert.equal(run.cwd, join(root, "drafts"));
  assert.equal(run.args[0], "--restricted");
  assert.equal(run.args[1], "--session-id");
  assert.deepEqual(run.args.slice(3), ["--name", "Copywriter"]);
});

test("the harness's exit code is passed through", async () => {
  const { root, home, log } = setup();
  setSession(root, "codex-re", { harness: "codex", id: "C1", confirmed: true });
  assert.equal(await launch(root, "codex-re", { env: env(home, log, { FAKE_EXIT: "3" }) }), 3);
});

test("a missing harness CLI is reported, not thrown", async () => {
  const { root, home, log } = setup();
  const errors: string[] = [];
  const code = await launch(root, "claude-po", { env: { ...env(home, log), PATH: "/nonexistent" }, stderr: (s) => errors.push(s) });
  assert.equal(code, 127);
  assert.match(errors.join(""), /claude.*not found/);
});


test("a Codex first launch whose conversation is never found: the next launch stops, no new conversation", async () => {
  const { root, home, log } = setup();
  const errors: string[] = [];
  // the marker shows up only after the harness has exited: never found
  await launch(root, "codex-re", { env: env(home, log, { FAKE_CODEX_DELAY_MS: "5000" }), stderr: (s) => errors.push(s) });
  assert.match(errors.join(""), /was not found; the next launch will stop/);
  const { brief: _b, ...entry } = loadSessions(root)["codex-re"];
  assert.deepEqual(entry, { harness: "codex", id: "", confirmed: false });
  const code = await launch(root, "codex-re", { env: env(home, log), stderr: (s) => errors.push(s) });
  assert.equal(code, 1);
  assert.equal(runs(log).length, 1, "no second conversation");
  assert.match(errors.join(""), /codex resume.*sessions\/codex-re\.json/s);
});

test("a recorded Codex id with no rollout (Codex keeps rollouts here) stops", async () => {
  const { root, home, log } = setup();
  writeFiles(home, { ".codex/sessions/2026/11/10/rollout-x-OTHER.jsonl": "{}\n" });
  setSession(root, "codex-re", { harness: "codex", id: "C1", confirmed: true });
  const errors: string[] = [];
  assert.equal(await launch(root, "codex-re", { env: env(home, log), stderr: (s) => errors.push(s) }), 1);
  assert.deepEqual(runs(log), []);
  assert.match(errors.join(""), /C1 not found in ~\/\.codex\/sessions/);
});

test("a missing codex CLI leaves no entry behind that would block the next launch", async () => {
  const { root, home, log } = setup();
  await launch(root, "codex-re", { env: { ...env(home, log), PATH: "/nonexistent" }, stderr: () => {} });
  assert.equal(loadSessions(root)["codex-re"], undefined);
});

test("launch makes the seat folder if a fresh checkout doesn't have it yet", async () => {
  const { root, home, log } = setup();
  await launch(root, "claude-po", { env: env(home, log) });
  assert.ok(existsSync(join(root, ".otterpack/seats/claude-po")));
});

test("first launch records the brief; an unchanged brief resumes with no prompt", async () => {
  const { root, home, log } = setup();
  writeFiles(root, { "CHARTER.md": "rules\n" });
  await launch(root, "claude-po", { env: env(home, log) });
  const brief = loadSessions(root)["claude-po"].brief!;
  assert.equal(brief.persona, "product-owner");
  assert.deepEqual(Object.keys(brief.files), [".otterpack/personas/product-owner.md", "CHARTER.md"]);
  await launch(root, "claude-po", { env: env(home, log) });
  assert.equal(runs(log)[1].args.at(-2), "--resume");
});

test("an edited persona: the next resume carries the re-brief once, and records the new brief", async () => {
  const { root, home, log } = setup();
  await launch(root, "claude-po", { env: env(home, log) });
  writeFiles(root, { ".otterpack/personas/product-owner.md": "po v2\n" });
  await launch(root, "claude-po", { env: env(home, log) });
  await launch(root, "claude-po", { env: env(home, log) });
  const [, second, third] = runs(log);
  assert.match(second.args.at(-1), /^\[seat:demo\/claude-po\] Your brief on this team changed since you last read it \(\.otterpack\/personas\/product-owner\.md changed\)/);
  assert.equal(third.args.at(-2), "--resume");
});

test("codex: a changed persona re-briefs on resume; an entry from before briefs only records one", async () => {
  const { root, home, log } = setup();
  setSession(root, "codex-re", { harness: "codex", id: "C1", confirmed: true });
  await launch(root, "codex-re", { env: env(home, log) });
  assert.deepEqual(runs(log)[0].args, ["resume", "-c", "check_for_update_on_startup=false", "C1"]);
  assert.equal(loadSessions(root)["codex-re"].brief?.persona, "devsecops");
  writeFiles(root, { ".otterpack/personas/devsecops.md": "d v2\n" });
  await launch(root, "codex-re", { env: env(home, log) });
  const args = runs(log)[1].args;
  assert.equal(args.at(-2), "C1");
  assert.match(args.at(-1), /Your brief on this team changed/);
  assert.equal(loadSessions(root)["codex-re"].id, "C1");
});
