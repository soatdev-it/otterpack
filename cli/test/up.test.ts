// up against a real tmux server on a private socket (otterpack-test-*), with fake harnesses.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { up } from "../src/up.ts";
import { project, fakeHome, tmp, markSynced } from "./helpers.ts";

const FAKE = fileURLToPath(new URL("./fake", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const SELF = [process.execPath, "--experimental-strip-types", "--no-warnings", INDEX];

const TEAM = `name: demo
library: ../lib
kits: []
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
  - id: codex-re
    label: DevSecOps
    icon: shield
    color: ansiBrightRed
    persona: none
    harness: codex
  - id: claude-ux
    label: UX
    icon: paintcan
    color: ansiMagenta
    persona: none
    harness: claude
    cwd: design
`;

const sockets: string[] = [];
after(() => {
  for (const s of sockets) {
    try { execFileSync("tmux", ["-L", s, "kill-server"], { stdio: "ignore" }); } catch { /* already gone */ }
    // A server that exited on its own can leave its socket file behind.
    rmSync(join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`, s), { force: true });
  }
});

function setup(extraEnv: Record<string, string> = {}) {
  const root = project(TEAM, { "design/.keep": "" });
  markSynced(root);
  const home = fakeHome();
  // tmux starts login shells, and /etc/profile resets PATH: put the fakes first again,
  // so a test can never start a real claude or codex.
  writeFileSync(join(home, ".bash_profile"), `export PATH=${JSON.stringify(FAKE)}:"$PATH"\n`);
  const log = join(tmp(), "log.jsonl");
  const socket = `otterpack-test-${process.pid}-${sockets.length}`;
  sockets.push(socket);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home, SHELL: "/bin/bash", PATH: `${FAKE}:${process.env.PATH}`, FAKE_LOG: log,
    OTTERPACK_TMUX_SOCKET: socket, ...extraEnv,
  };
  delete env.TMUX;
  delete env.TEAM_TMUX_SOCKET;
  const t = (...a: string[]) => execFileSync("tmux", ["-L", socket, ...a], { encoding: "utf8", env }).trim();
  const opts = { env, self: SELF, attach: false };
  return { root, home, log, socket, env, t, opts };
}

const runs = (log: string) => {
  const all = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  for (const r of all) assert.ok(r.name === "claude" || r.name === "codex", "only the fake harness runs");
  return all;
};

async function waitFor(what: string, cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const pane = (t: (...a: string[]) => string, s: string) => t("display-message", "-p", "-t", `=${s}:`, "#{pane_current_command}");

test("up creates one session per seat, named by seat id, and launches each harness in its cwd", async () => {
  const { root, log, t, opts } = setup();
  await up(root, [], opts);
  assert.deepEqual(t("list-sessions", "-F", "#{session_name}").split("\n").sort(), ["claude-po", "claude-ux", "codex-re"]);
  assert.equal(t("display-message", "-p", "-t", "=claude-po:", "#{window_name}"), "PO");
  await waitFor("3 harness runs", () => runs(log).length === 3);
  const byName = Object.fromEntries(runs(log).map((r) => [r.cwd === join(root, "design") ? "ux" : r.name, r]));
  assert.ok(byName.ux, "claude-ux started in design/");
  assert.ok(byName.codex);
});

test("a running seat is only attached to, never relaunched", async () => {
  const { root, log, t, opts } = setup();
  await up(root, ["claude-po"], opts);
  await waitFor("first run", () => runs(log).length === 1);
  await waitFor("harness running", () => pane(t, "claude-po") !== "bash");
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: already running/);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(runs(log).length, 1);
});

test("a bare shell (harness exited) gets the launch typed again", async () => {
  const { root, log, t, opts } = setup({ FAKE_EXIT: "0" });
  await up(root, ["claude-po"], opts);
  await waitFor("first run", () => runs(log).length === 1);
  await waitFor("back to a bare shell", () => pane(t, "claude-po") === "bash");
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: bare shell, relaunched/);
  await waitFor("second run", () => runs(log).length === 2);
  // persona: none sends no first message, so no transcript yet: same id, launched afresh
  const id = (r: any) => r.args[r.args.indexOf("--session-id") + 1];
  assert.equal(id(runs(log)[1]), id(runs(log)[0]));
});

test("TEAM_TMUX_SOCKET rehearsal: sessions are created, the launch is a no-op", async () => {
  const s = setup();
  const env = { ...s.env, TEAM_TMUX_SOCKET: s.socket };
  delete (env as Record<string, string>).OTTERPACK_TMUX_SOCKET;
  await up(s.root, [], { ...s.opts, env });
  assert.equal(s.t("list-sessions").split("\n").length, 3);
  await new Promise((r) => setTimeout(r, 1000));
  assert.deepEqual(runs(s.log), []);
  assert.match(s.t("capture-pane", "-p", "-J", "-t", "=claude-po:"), /^\$? ?: .*launch claude-po/m);
});

test("the first up on a new server runs the tmux-resurrect restore once", async () => {
  const { root, home, t, opts } = setup();
  const scripts = join(home, ".tmux/plugins/tmux-resurrect/scripts");
  mkdirSync(scripts, { recursive: true });
  const marks = join(home, "restored");
  writeFileSync(join(scripts, "restore.sh"), `#!/bin/sh\necho x >> '${marks}'\n`);
  chmodSync(join(scripts, "restore.sh"), 0o755);
  await up(root, ["claude-po"], opts);
  await up(root, ["codex-re"], opts);
  assert.equal(readFileSync(marks, "utf8"), "x\n");
  assert.ok(!t("list-sessions", "-F", "#{session_name}").includes("_team_boot"));
});

test("a seat restored by tmux-resurrect as a bare shell is relaunched by the first up", async () => {
  const { root, home, log, t, opts } = setup();
  const scripts = join(home, ".tmux/plugins/tmux-resurrect/scripts");
  mkdirSync(scripts, { recursive: true });
  // resurrect brings back the seat's session (a bare shell) and an ad-hoc one of the user
  writeFileSync(join(scripts, "restore.sh"), `#!/bin/sh\ntmux new-session -d -s claude-po -c '${root}'\ntmux new-session -d -s my-notes\n`);
  chmodSync(join(scripts, "restore.sh"), 0o755);
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: bare shell, relaunched/);
  assert.ok(t("list-sessions", "-F", "#{session_name}").split("\n").includes("my-notes"));
  await waitFor("relaunched", () => runs(log).length === 1);
});

test("a TEAM_TMUX_SOCKET rehearsal never runs the tmux-resurrect restore", async () => {
  const s = setup();
  const scripts = join(s.home, ".tmux/plugins/tmux-resurrect/scripts");
  mkdirSync(scripts, { recursive: true });
  const marks = join(s.home, "restored");
  writeFileSync(join(scripts, "restore.sh"), `#!/bin/sh\necho x >> '${marks}'\n`);
  chmodSync(join(scripts, "restore.sh"), 0o755);
  const env = { ...s.env, TEAM_TMUX_SOCKET: s.socket };
  delete (env as Record<string, string>).OTTERPACK_TMUX_SOCKET;
  await up(s.root, ["claude-po"], { ...s.opts, env });
  assert.ok(!existsSync(marks));
});

test("seats opened at the same time (VS Code folder open) each start exactly once", async () => {
  const { root, log, env, t } = setup();
  const outputs: string[] = [];
  const one = (seat: string) =>
    new Promise<number>((res) => {
      const p = spawn(SELF[0], [...SELF.slice(1), "up", seat, "--no-attach"], { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] });
      p.stdout.on("data", (d) => outputs.push(String(d)));
      p.on("exit", (c) => res(c ?? -1));
    });
  const codes = await Promise.all(["claude-po", "codex-re", "claude-ux", "claude-po", "codex-re"].map(one));
  assert.deepEqual(codes, [0, 0, 0, 0, 0]);
  // the second up of a seat must see it running, not type the launch again into the harness
  const out = outputs.join("");
  assert.equal(out.match(/created and launched/g)?.length, 3, out);
  assert.equal(out.match(/already running|: starting \(/g)?.length, 2, out);
  assert.doesNotMatch(out, /bare shell, relaunched/);
  assert.equal(t("list-sessions").split("\n").length, 3);
  await waitFor("3 harness runs", () => runs(log).length === 3);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(runs(log).length, 3);
});

test("with a slow login shell, seats don't wait for each other, and a seat's second up never types its launch again", async () => {
  const { root, home, log, env, t } = setup();
  // A login shell that takes 7s (nvm, oh-my-zsh…): longer than any lock wait used to be.
  writeFileSync(join(home, ".bash_profile"), `export PATH=${JSON.stringify(FAKE)}:"$PATH"\nsleep 7\n`);
  const outputs: string[] = [];
  const one = (seat: string) =>
    new Promise<number>((res) => {
      const p = spawn(SELF[0], [...SELF.slice(1), "up", seat, "--no-attach"], { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] });
      p.stdout.on("data", (d) => outputs.push(String(d)));
      p.on("exit", (c) => res(c ?? -1));
    });
  const started = Date.now();
  const first = await Promise.all(["claude-po", "codex-re", "claude-ux"].map(one));
  // The second up of claude-po arrives while its shell is still starting.
  const second = await one("claude-po");
  assert.deepEqual([...first, second], [0, 0, 0, 0]);
  assert.ok(Date.now() - started < 5_000, `ups took ${Date.now() - started}ms: they waited on the shells`);
  const out = outputs.join("");
  assert.equal(out.match(/created and launched/g)?.length, 3, out);
  assert.match(out, /claude-po: starting \(its launch was typed \d+s ago; its shell hasn't run it yet\), attaching only/);
  assert.doesNotMatch(out, /bare shell, relaunched/);
  // Once the shells have run the launches: one harness per seat, and no mark left behind.
  await waitFor("3 harness runs", () => runs(log).length === 3, 20_000);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(runs(log).length, 3);
  for (const s of ["claude-po", "codex-re", "claude-ux"]) {
    assert.equal(t("show-options", "-v", "-t", `=${s}:`, "-q", "@otterpack_launching"), "", `${s} still marked as starting`);
  }
});

test("a stale starting mark (its launch never ran) doesn't stop a relaunch", async () => {
  const { root, log, opts, t } = setup();
  t("new-session", "-d", "-s", "claude-po", "-c", root);
  t("set-option", "-t", "=claude-po:", "@otterpack_root", root);
  t("set-option", "-t", "=claude-po:", "@otterpack_launching", String(Date.now() - 10 * 60_000));
  await waitFor("bare shell", () => pane(t, "claude-po") === "bash");
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: bare shell, relaunched/);
  await waitFor("run", () => runs(log).length === 1);
});

test("--dry-run reports each seat and changes nothing", async () => {
  const { root, log, t, opts } = setup();
  await up(root, ["claude-po"], opts);
  await waitFor("run", () => runs(log).length === 1);
  await waitFor("harness running", () => pane(t, "claude-po") !== "bash");
  const lines = await up(root, [], { ...opts, dryRun: true });
  const text = lines.join("\n");
  assert.match(text, /claude-po\s+running\s+claude\s+[0-9a-f-]{36}/);
  assert.match(text, /codex-re\s+stopped\s+codex\s+-\s+would create the session and launch; new conversation/);
  assert.equal(t("list-sessions").split("\n").length, 1);
});

test("an unknown seat is an error", async () => {
  const { root, opts } = setup();
  await assert.rejects(up(root, ["nope"], opts), /no seat "nope"/);
});

test("unsynced: up won't start or relaunch a seat, but still attaches to a running one and dry-runs", async () => {
  const { root, log, opts, t } = setup();
  await up(root, ["claude-po"], opts);
  await waitFor("run", () => runs(log).length === 1);
  await waitFor("harness running", () => pane(t, "claude-po") !== "bash");
  writeFileSync(join(root, ".otterpack/team.yaml"), TEAM.replace("label: UX", "label: Design"));
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: already running/);
  assert.match(lines.join("\n"), /team\.yaml changed since the last sync/);
  await assert.rejects(up(root, ["codex-re"], opts), /team\.yaml changed since the last sync: run otterpack sync/);
  const dry = await up(root, [], { ...opts, dryRun: true });
  assert.match(dry[0], /team\.yaml changed since the last sync/);
  const fresh = project(TEAM, { "design/.keep": "" });
  await assert.rejects(up(fresh, ["claude-ux"], opts), /not synced yet: run otterpack sync/);
});

test("up marks the sessions it creates, and never attaches to another project's same-named session", async () => {
  const { root, log, opts, t } = setup();
  await up(root, ["codex-re"], opts);
  assert.equal(t("show-options", "-v", "-t", "=codex-re:", "@otterpack_root"), root);
  t("new-session", "-d", "-s", "claude-po", "-c", tmp(), "sleep 600");
  const lines = await up(root, ["claude-po"], opts);
  assert.match(lines.join("\n"), /claude-po: .*another project/);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(runs(log).filter((r) => r.name === "claude").length, 0);
});

test("up skips a disabled seat, and refuses to start one by name", async () => {
  const { root, opts, t } = setup();
  writeFileSync(join(root, ".otterpack/team.yaml"), TEAM.replace("    harness: codex\n", "    harness: codex\n    disabled: true\n"));
  markSynced(root);
  const lines = await up(root, [], opts);
  assert.match(lines.join("\n"), /codex-re: disabled, not started/);
  assert.deepEqual(t("list-sessions", "-F", "#{session_name}").split("\n").sort(), ["claude-po", "claude-ux"]);
  await assert.rejects(up(root, ["codex-re"], opts), /codex-re is disabled: otterpack enable codex-re/);
  const dry = await up(root, [], { ...opts, dryRun: true });
  assert.match(dry.join("\n"), /codex-re\s+disabled/);
});
