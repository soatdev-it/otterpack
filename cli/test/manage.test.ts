// Team management commands: status, add, remove, stop, reset. tmux runs on a private socket.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { sync } from "../src/sync.ts";
import { loadTeam } from "../src/config.ts";
import { briefOf } from "../src/kickoff.ts";
import { setSession, loadSessions } from "../src/sessions.ts";
import { addSeat, removeSeat, stopSeats, resetSeat, status, disableSeat, enableSeat, addKit, removeKit, rebriefNotice } from "../src/manage.ts";
import { libraryRepo, project, read, exists, fakeHome, writeFiles } from "./helpers.ts";

const LIB = {
  "personas/product-owner.md": "# PO\n",
  "personas/architect.md": "# Architect\n",
  "kits/core/agents/planner.md": "plan\n",
};

const TEAM = (lib: string) => `# My team. Comments survive edits.
library: ${lib}
kits: [core]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
  - id: claude-web
    label: Web dev
    icon: code
    color: ansiGreen
    persona: none
    harness: claude
`;

const sockets: string[] = [];
after(() => {
  for (const s of sockets) {
    try { execFileSync("tmux", ["-L", s, "kill-server"], { stdio: "ignore" }); } catch { /* gone */ }
    // A server that exited on its own can leave its socket file behind.
    rmSync(join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`, s), { force: true });
  }
});

function setup() {
  const lib = libraryRepo(LIB);
  const root = project(TEAM(lib));
  const home = fakeHome();
  sync(root, { home });
  const socket = `otterpack-test-${process.pid}-m${sockets.length}`;
  sockets.push(socket);
  const env = { ...process.env, HOME: home, OTTERPACK_TMUX_SOCKET: socket } as NodeJS.ProcessEnv;
  delete env.TMUX;
  delete env.TEAM_TMUX_SOCKET;
  const t = (...a: string[]) => execFileSync("tmux", ["-L", socket, ...a], { encoding: "utf8", env }).trim();
  // A stand-in for a running seat: a session with a long-running command, started in the
  // project (as up does) unless another folder is given.
  const fakeSeat = (id: string, cwd = root, cmd = "sleep 600") => t("new-session", "-d", "-s", id, "-c", cwd, cmd);
  const sessions = () => { try { return t("list-sessions", "-F", "#{session_name}").split("\n").sort(); } catch { return []; } };
  return { lib, root, home, env, t, fakeSeat, sessions, socket };
}

test("add appends a seat to team.yaml (comments kept), syncs, and gives it a folder", () => {
  const { root, home } = setup();
  addSeat(root, { id: "claude-ar", label: "Architect", persona: "architect" }, { home });
  const text = read(root, ".otterpack/team.yaml");
  assert.match(text, /^# My team\. Comments survive edits\./);
  const seat = loadTeam(root).seats.find((s) => s.id === "claude-ar")!;
  assert.deepEqual(
    { label: seat.label, persona: seat.persona, harness: seat.harness, icon: seat.icon, color: seat.color },
    { label: "Architect", persona: "architect", harness: "claude", icon: "person", color: "ansiWhite" },
  );
  assert.equal(read(root, ".otterpack/personas/architect.md"), "# Architect\n");
  assert.match(read(root, ".vscode/tasks.json"), /"label": "Architect"/);
  assert.ok(exists(root, ".otterpack/seats/claude-ar"));
});

test("add takes the harness from a codex- id and the label from the id when not given", () => {
  const { root, home } = setup();
  addSeat(root, { id: "codex-re", persona: "none" }, { home });
  const seat = loadTeam(root).seats.find((s) => s.id === "codex-re")!;
  assert.equal(seat.harness, "codex");
  assert.equal(seat.label, "codex-re");
});

test("add refuses a duplicate id and leaves team.yaml unchanged", () => {
  const { root, home } = setup();
  const before = read(root, ".otterpack/team.yaml");
  assert.throws(() => addSeat(root, { id: "claude-po", persona: "none" }, { home }), /duplicate seat id "claude-po"/);
  assert.equal(read(root, ".otterpack/team.yaml"), before);
});

test("add with an unknown persona rolls team.yaml back", () => {
  const { root, home } = setup();
  const before = read(root, ".otterpack/team.yaml");
  assert.throws(() => addSeat(root, { id: "claude-x", persona: "nobody" }, { home }), /persona "nobody"/);
  assert.equal(read(root, ".otterpack/team.yaml"), before);
});

test("remove stops the seat, drops it from team.yaml and tasks.json, forgets its conversation, keeps its folder", () => {
  const { root, home, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po");
  setSession(root, "claude-po", { harness: "claude", id: "11111111-1111-1111-1111-111111111111", confirmed: true });
  writeFileSync(join(root, ".otterpack/seats/claude-po/BACKLOG.md"), "notes\n");
  const r = removeSeat(root, "claude-po", { env, home });
  assert.equal(r.stopped, true);
  assert.deepEqual(loadTeam(root).seats.map((s) => s.id), ["claude-web"]);
  assert.doesNotMatch(read(root, ".vscode/tasks.json"), /"label": "PO"/);
  assert.ok(!exists(root, ".otterpack/personas/product-owner.md"), "persona no longer used: removed");
  assert.deepEqual(sessions(), []);
  assert.equal(loadSessions(root)["claude-po"], undefined);
  assert.equal(read(root, ".otterpack/seats/claude-po/BACKLOG.md"), "notes\n");
  assert.match(read(root, ".otterpack/team.yaml"), /^# My team\./);
});

test("remove --keep-conversation keeps the conversation id for a later add", () => {
  const { root, home, env } = setup();
  setSession(root, "claude-po", { harness: "claude", id: "22222222-2222-2222-2222-222222222222", confirmed: true });
  removeSeat(root, "claude-po", { env, home, keepConversation: true });
  assert.equal(loadSessions(root)["claude-po"].id, "22222222-2222-2222-2222-222222222222");
});

test("remove refuses an unknown seat and the last seat", () => {
  const { root, home, env } = setup();
  assert.throws(() => removeSeat(root, "claude-zz", { env, home }), /no seat "claude-zz"/);
  removeSeat(root, "claude-po", { env, home });
  assert.throws(() => removeSeat(root, "claude-web", { env, home }), /last seat/);
});

test("stop ends the named seats' sessions and keeps their conversations", () => {
  const { root, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po");
  fakeSeat("claude-web");
  fakeSeat("not-a-seat");
  setSession(root, "claude-po", { harness: "claude", id: "33333333-3333-3333-3333-333333333333", confirmed: true });
  const lines = stopSeats(root, ["claude-po"], { env });
  assert.match(lines.join("\n"), /claude-po: stopped/);
  assert.deepEqual(sessions(), ["claude-web", "not-a-seat"]);
  assert.equal(loadSessions(root)["claude-po"].id, "33333333-3333-3333-3333-333333333333");
});

test("stop with no seat stops every seat, and only seats", () => {
  const { root, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po");
  fakeSeat("not-a-seat");
  const lines = stopSeats(root, [], { env });
  assert.match(lines.join("\n"), /claude-po: stopped/);
  assert.match(lines.join("\n"), /claude-web: not running/);
  assert.deepEqual(sessions(), ["not-a-seat"]);
});

test("reset stops the seat and forgets its conversation, so the next up starts afresh", () => {
  const { root, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po");
  setSession(root, "claude-po", { harness: "claude", id: "44444444-4444-4444-4444-444444444444", confirmed: true });
  resetSeat(root, "claude-po", { env });
  assert.deepEqual(sessions(), []);
  assert.equal(loadSessions(root)["claude-po"], undefined);
  assert.ok(existsSync(join(root, ".otterpack/seats/claude-po")), "the folder stays");
});

test("status names the seats whose brief changed since they last read it", () => {
  const { root, env, home } = setup();
  const team = loadTeam(root);
  setSession(root, "claude-po", { harness: "claude", id: "U1", confirmed: true, brief: briefOf(team, team.seats[0], root) });
  assert.equal(status(root, { env, home }).seats[0].briefChanges, undefined);
  writeFileSync(join(root, ".otterpack/personas/product-owner.md"), "# PO v2\n");
  const s = status(root, { env, home });
  assert.deepEqual(s.seats[0].briefChanges, [".otterpack/personas/product-owner.md changed"]);
  assert.equal(s.seats[1].briefChanges, undefined, "no conversation, nothing to re-brief");
});

test("rebriefNotice names the seats a sync or update leaves with a changed brief", () => {
  const { root } = setup();
  const team = loadTeam(root);
  setSession(root, "claude-po", { harness: "claude", id: "U1", confirmed: true, brief: briefOf(team, team.seats[0], root) });
  assert.equal(rebriefNotice(root), undefined);
  writeFileSync(join(root, ".otterpack/personas/product-owner.md"), "# PO v2\n");
  assert.equal(rebriefNotice(root), "1 seat's brief changed (claude-po): it gets a re-brief when it next starts; otterpack status says more.");
});

test("status lists every seat with its state and conversation, and the sync state", () => {
  const { root, env, home, fakeSeat } = setup();
  fakeSeat("claude-po");
  setSession(root, "claude-po", { harness: "claude", id: "55555555-5555-5555-5555-555555555555", confirmed: true });
  const s = status(root, { env, home });
  assert.equal(s.syncProblem, undefined);
  assert.deepEqual(
    s.seats.map((r) => [r.id, r.label, r.harness, r.persona, r.state, r.conversation]),
    [
      ["claude-po", "PO", "claude", "product-owner", "running", "55555555-5555-5555-5555-555555555555"],
      ["claude-web", "Web dev", "claude", "none", "stopped", undefined],
    ],
  );
  writeFileSync(join(root, ".otterpack/team.yaml"), read(root, ".otterpack/team.yaml").replace("label: Web dev", "label: Web"));
  assert.match(status(root, { env, home }).syncProblem ?? "", /team\.yaml changed since the last sync/);
});

const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const elsewhere = () => mkdtempSync(join(tmpdir(), "otterpack-other-"));
async function waitFor(what: string, cond: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a same-named session of another project is never stopped, reset or removed, and status says so", () => {
  const { root, home, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po", elsewhere());
  setSession(root, "claude-po", { harness: "claude", id: "66666666-6666-6666-6666-666666666666", confirmed: true });
  assert.match(stopSeats(root, ["claude-po"], { env }).join("\n"), /claude-po: .*another project/);
  assert.match(resetSeat(root, "claude-po", { env }).join("\n"), /another project/);
  assert.equal(status(root, { env, home }).seats[0].state, "other project");
  const r = removeSeat(root, "claude-po", { env, home });
  assert.equal(r.stopped, false);
  assert.deepEqual(sessions(), ["claude-po"]);
});

test("a session up marked as this project's counts as ours wherever its shell is", () => {
  const { root, env, t, fakeSeat, sessions } = setup();
  fakeSeat("claude-po", elsewhere());
  t("set-option", "-t", "=claude-po:", "@otterpack_root", root);
  assert.match(stopSeats(root, ["claude-po"], { env }).join("\n"), /claude-po: stopped/);
  assert.deepEqual(sessions(), []);
});

// The commands typed into a seat's own pane, as an agent or a person would: the session
// they run in goes last, and nothing is left half-done.
function typeIn(s: ReturnType<typeof setup>, seat: string, args: string) {
  const cmd = `OTTERPACK_TMUX_SOCKET=${s.socket} HOME='${s.home}' '${process.execPath}' --experimental-strip-types --no-warnings '${INDEX}' ${args}`;
  s.t("send-keys", "-t", `=${seat}:`, "-l", cmd);
  s.t("send-keys", "-t", `=${seat}:`, "Enter");
}

test("stop typed inside a seat stops the other seats too, its own last", async () => {
  const s = setup();
  s.fakeSeat("claude-po", s.root, "bash --norc");
  s.fakeSeat("claude-web");
  typeIn(s, "claude-po", "stop");
  await waitFor("both seats stopped", () => s.sessions().length === 0);
});

test("reset typed inside the seat itself still forgets the conversation", async () => {
  const s = setup();
  s.fakeSeat("claude-web", s.root, "bash --norc");
  setSession(s.root, "claude-web", { harness: "claude", id: "77777777-7777-7777-7777-777777777777", confirmed: true });
  typeIn(s, "claude-web", "reset claude-web");
  await waitFor("seat stopped", () => s.sessions().length === 0);
  assert.equal(loadSessions(s.root)["claude-web"], undefined);
});

test("removing the first seat takes its comment with it", () => {
  const lib = libraryRepo(LIB);
  const root = project(`library: ${lib}
kits: []
seats:
  # The product seat
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
  # The web seat
  - id: claude-web
    label: Web
    icon: code
    color: ansiGreen
    persona: none
    harness: claude
`);
  const home = fakeHome();
  sync(root, { home });
  removeSeat(root, "claude-po", { env: { ...process.env, OTTERPACK_TMUX_SOCKET: "otterpack-test-unused" }, home });
  const text = read(root, ".otterpack/team.yaml");
  assert.doesNotMatch(text, /product seat/);
  assert.match(text, /# The web seat/);
});

test("the CLI rejects unknown options and wrong arity instead of guessing", () => {
  const { root, home } = setup();
  const cli = (...a: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", INDEX, ...a], { cwd: root, env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.match(cli("add", "--bogus", "claude-x", "--persona", "none").stderr, /unknown option --bogus/);
  assert.match(cli("add", "claude-x").stderr, /add needs --persona/);
  assert.match(cli("add", "claude-x", "--persona", "none", "--harness", "gpt").stderr, /--harness must be claude or codex/);
  assert.match(cli("reset", "claude-po", "claude-web").stderr, /reset needs exactly one seat id/);
  assert.match(cli("remove", "claude-po", "--keep").stderr, /unknown option --keep/);
  assert.match(cli("stop", "--all").stderr, /unknown option --all/);
  const ok = cli("add", "--persona", "none", "--label", "QA team", "claude-qa");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(loadTeam(root).seats.at(-1)!.label, "QA team");
});

test("disable stops the seat and keeps it off: no task, persona, folder and conversation kept; enable brings it back", () => {
  const { root, home, env, fakeSeat, sessions } = setup();
  fakeSeat("claude-po");
  setSession(root, "claude-po", { harness: "claude", id: "88888888-8888-8888-8888-888888888888", confirmed: true });
  const lines = disableSeat(root, "claude-po", { env, home });
  assert.match(lines.join("\n"), /claude-po: stopped and disabled/);
  assert.deepEqual(sessions(), []);
  assert.equal(loadTeam(root).seats[0].disabled, true);
  assert.match(read(root, ".otterpack/team.yaml"), /^# My team\./);
  assert.doesNotMatch(read(root, ".vscode/tasks.json"), /"label": "PO"/);
  assert.equal(read(root, ".otterpack/personas/product-owner.md"), "# PO\n");
  assert.equal(loadSessions(root)["claude-po"].id, "88888888-8888-8888-8888-888888888888");
  assert.equal(status(root, { env, home }).seats[0].state, "disabled");
  assert.match(disableSeat(root, "claude-po", { env, home }).join("\n"), /already disabled/);

  assert.match(enableSeat(root, "claude-po", { home }).join("\n"), /claude-po: enabled/);
  assert.equal(loadTeam(root).seats[0].disabled, false);
  assert.doesNotMatch(read(root, ".otterpack/team.yaml"), /disabled/);
  assert.match(read(root, ".vscode/tasks.json"), /"label": "PO"/);
  assert.match(enableSeat(root, "claude-po", { home }).join("\n"), /already enabled/);
});

test("disable and enable refuse an unknown seat", () => {
  const { root, home, env } = setup();
  assert.throws(() => disableSeat(root, "claude-zz", { env, home }), /no seat "claude-zz"/);
  assert.throws(() => enableSeat(root, "claude-zz", { home }), /no seat "claude-zz"/);
});

test("kit add and kit remove edit kits: (comments kept) and sync", () => {
  const { root, home } = setup();
  writeFiles(root, { ".otterpack/local/kits/stack-astro/agents/typescript-reviewer.md": "ts\n" });
  addKit(root, "stack-astro", { home });
  assert.deepEqual(loadTeam(root).kits, ["core", "stack-astro"]);
  assert.equal(read(root, ".claude/agents/typescript-reviewer.md"), "ts\n");
  assert.match(read(root, ".otterpack/team.yaml"), /^# My team\./);
  assert.throws(() => addKit(root, "stack-astro", { home }), /already in kits/);
  assert.throws(() => addKit(root, "nope", { home }), /kit "nope" is neither/);
  assert.deepEqual(loadTeam(root).kits, ["core", "stack-astro"], "a failed add leaves team.yaml as it was");
  removeKit(root, "stack-astro", { home });
  assert.deepEqual(loadTeam(root).kits, ["core"]);
  assert.ok(!exists(root, ".claude/agents/typescript-reviewer.md"));
  assert.throws(() => removeKit(root, "stack-astro", { home }), /not in kits/);
});
