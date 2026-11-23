import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doctor, type Check } from "../src/doctor.ts";
import { libraryRepo, project, fakeHome, tmp, markSynced } from "./helpers.ts";

// Throwaway CLIs that answer the exact commands doctor runs. Never the real ones.
function fakeBin(behaviour: { claudeLoggedIn?: boolean; codexLoggedIn?: boolean; sandboxRc?: number; otterpack?: boolean }) {
  const bin = tmp("otterpack-bin-");
  const sh = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  sh("claude", `case "$1 $2" in
  "--version "*) echo "2.1.318 (Claude Code)";;
  "auth status") echo '{"loggedIn": ${behaviour.claudeLoggedIn ?? true}}';;
  *) echo "unexpected: $*" >&2; exit 99;;
esac`);
  sh("codex", `case "$1 $2" in
  "--version "*) echo "codex-cli 0.166.0";;
  "login status") ${behaviour.codexLoggedIn === false ? 'echo "Not logged in"; exit 1' : 'echo "Logged in using ChatGPT"'};;
  "sandbox --") ${behaviour.sandboxRc ? `echo "bwrap: No permissions to create a new namespace" >&2; exit ${behaviour.sandboxRc}` : "exit 0"};;
  *) echo "unexpected: $*" >&2; exit 99;;
esac`);
  if (behaviour.otterpack !== false) sh("otterpack", "exit 0");
  return bin;
}

const TEAM = (lib: string, codex = true, extra = "") => `library: ${lib}
kits: []
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
${codex ? `  - id: codex-re
    label: DevSecOps
    icon: shield
    color: ansiBrightRed
    persona: none
    harness: codex
` : ""}${extra}`;

function run(opts: { team?: string; bin?: ReturnType<typeof fakeBin>; container?: boolean; mounts?: string[]; synced?: boolean } = {}) {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const root = project(opts.team ?? TEAM(lib));
  if (opts.synced !== false) markSynced(root);
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  const bin = opts.bin ?? fakeBin({});
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  const mountinfo = (opts.mounts ?? []).map((m, i) => `${i} 1 0:1 / ${m} rw - ext4 /dev/x rw`).join("\n");
  return { checks: doctor(root, { env, inContainer: opts.container ?? false, mountinfo }), lib, home };
}

const byName = (checks: Check[], name: RegExp) => checks.filter((c) => name.test(c.name));
const fails = (checks: Check[]) => checks.filter((c) => c.status === "fail").map((c) => c.name);

test("all green with working CLIs, logins, sandbox and a reachable library", () => {
  const { checks } = run();
  assert.deepEqual(fails(checks), []);
  for (const n of [/^tmux/, /^git/, /^team\.yaml/, /^claude CLI/, /^claude login/, /^codex CLI/, /^codex login/, /^codex sandbox/, /^library/, /^otterpack on PATH/, /^user/, /^sync/]) {
    assert.equal(byName(checks, n).length, 1, `missing check ${n}`);
  }
});

test("a logged-out harness fails, checked by command (no credential file is read)", () => {
  const { checks } = run({ bin: fakeBin({ claudeLoggedIn: false, codexLoggedIn: false }) });
  assert.deepEqual(fails(checks).sort(), ["claude login", "codex login"]);
});

test("the Codex sandbox failing is a failure with the reason", () => {
  const { checks } = run({ bin: fakeBin({ sandboxRc: 1 }) });
  const [c] = byName(checks, /^codex sandbox/);
  assert.equal(c.status, "fail");
  assert.match(c.detail, /namespace/);
});

test("no Codex seat, no Codex checks", () => {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const { checks } = run({ team: TEAM(lib, false) });
  assert.deepEqual(byName(checks, /^codex/), []);
});

test("in a container, a home folder that is not a mount is a warning (lost on rebuild)", () => {
  const r = run({ container: true });
  const c = byName(r.checks, /^~\/\.claude survives a rebuild/)[0];
  assert.equal(c.status, "warn");
});

test("in a container, mounted home folders are fine", () => {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const root = project(TEAM(lib));
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  const env = { HOME: home, PATH: `${fakeBin({})}:/usr/bin:/bin` };
  const mountinfo = [`1 1 0:1 / ${home}/.claude rw - ext4 /dev/x rw`, `2 1 0:1 / ${home}/.codex rw - ext4 /dev/x rw`].join("\n");
  const checks = doctor(root, { env, inContainer: true, mountinfo });
  assert.deepEqual(byName(checks, /^~\/.*survives a rebuild/).map((c) => c.status), ["ok", "ok"]);
});

test("in a container, a mount on a parent folder (a whole-home volume) counts", () => {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const root = project(TEAM(lib));
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  const env = { HOME: home, PATH: `${fakeBin({})}:/usr/bin:/bin` };
  const mountinfo = [`1 0 0:1 / / rw - overlay overlay rw`, `2 1 0:2 / ${home} rw - ext4 /dev/x rw`, `3 1 0:3 / ${root} rw - ext4 /dev/y rw`].join("\n");
  const checks = doctor(root, { env, inContainer: true, mountinfo });
  assert.deepEqual(byName(checks, /survives a rebuild/).map((c) => [c.name, c.status]), [
    ["~/.claude survives a rebuild", "ok"], ["~/.codex survives a rebuild", "ok"], [".otterpack/state survives a rebuild", "ok"],
  ]);
});

test("in a container, the container's own root filesystem doesn't count as persistent", () => {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const root = project(TEAM(lib));
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".codex"));
  const env = { HOME: home, PATH: `${fakeBin({})}:/usr/bin:/bin` };
  const checks = doctor(root, { env, inContainer: true, mountinfo: "1 0 0:1 / / rw - overlay overlay rw" });
  assert.ok(byName(checks, /survives a rebuild/).every((c) => c.status === "warn"));
});

test("an unreachable library fails", () => {
  const { checks } = run({ team: TEAM("/nonexistent/library-repo") });
  assert.equal(byName(checks, /^library/)[0].status, "fail");
});

test("a launcher that is missing or not executable fails", () => {
  const lib = libraryRepo({ "personas/x.md": "x\n" });
  const extra = `  - id: claude-copy
    label: Copywriter
    icon: globe
    color: ansiBrightMagenta
    persona: none
    harness: claude
    launcher: .otterpack/local/copy.sh
`;
  const { checks } = run({ team: TEAM(lib, false, extra) });
  const [c] = byName(checks, /^launcher claude-copy/);
  assert.equal(c.status, "fail");
});

test("otterpack missing from the plain PATH is a warning (VS Code tasks need it)", () => {
  const { checks } = run({ bin: fakeBin({ otterpack: false }) });
  assert.equal(byName(checks, /^otterpack on PATH/)[0].status, "warn");
});

test("a project that is not synced (or whose team.yaml changed since) fails the sync check", () => {
  const { checks } = run({ synced: false });
  assert.deepEqual(fails(checks), ["sync"]);
  assert.match(byName(checks, /^sync/)[0].detail, /not synced yet: run otterpack sync/);
});
