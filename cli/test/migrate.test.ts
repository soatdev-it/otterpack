// migrate: a project set up by agentteam (.agentteam/, the old command name) moves to
// .otterpack/ without losing its seats' conversations. tmux runs on a private socket.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sync, LOCK_FILE, type Lock } from "../src/sync.ts";
import { ConfigError, findRoot, loadTeam } from "../src/config.ts";
import { briefChanges, briefOf, FOLDER_MOVED, renderRebrief } from "../src/kickoff.ts";
import { loadSessions, setSession } from "../src/sessions.ts";
import { rebriefNotice } from "../src/manage.ts";
import { migrate } from "../src/migrate.ts";
import * as tmux from "../src/tmux.ts";
import { libraryRepo, project, read, exists, fakeHome } from "./helpers.ts";

const LIB = { "personas/product-owner.md": "# PO\n", "kits/core/agents/planner.md": "plan\n" };
const TEAM = (lib: string) => `library: ${lib}
kits: [core]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
`;

const sockets: string[] = [];
after(() => {
  for (const s of sockets) {
    try { execFileSync("tmux", ["-L", s, "kill-server"], { stdio: "ignore" }); } catch { /* gone */ }
    rmSync(join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`, s), { force: true });
  }
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const toLegacy = (p: string) => p.replace(/^\.otterpack\//, ".agentteam/");

/** A project as agentteam 0.3 left it: .agentteam/, its lock naming .agentteam/ paths, tasks running agentteam. */
function legacyProject() {
  const lib = libraryRepo(LIB);
  const root = project(TEAM(lib));
  const home = fakeHome();
  sync(root, { home });
  const team = loadTeam(root);
  const brief = briefOf(team, team.seats[0], root);
  setSession(root, "claude-po", {
    harness: "claude", id: "11111111-1111-1111-1111-111111111111", confirmed: true,
    brief: { ...brief, files: Object.fromEntries(Object.entries(brief.files).map(([f, h]) => [toLegacy(f), h])) },
  });
  const tasksPath = join(root, ".vscode/tasks.json");
  const tasks = readFileSync(tasksPath, "utf8").replaceAll("otterpack", "agentteam");
  writeFileSync(tasksPath, tasks);
  const lock = JSON.parse(read(root, LOCK_FILE)) as Lock;
  lock.files = Object.fromEntries(Object.entries(lock.files).map(([p, h]) => [toLegacy(p), p === ".vscode/tasks.json" ? sha(tasks) : h]));
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");
  renameSync(join(root, ".otterpack"), join(root, ".agentteam"));

  const socket = `otterpack-test-${process.pid}-g${sockets.length}`;
  sockets.push(socket);
  const env = { ...process.env, HOME: home, OTTERPACK_TMUX_SOCKET: socket } as NodeJS.ProcessEnv;
  delete env.TMUX;
  delete env.TEAM_TMUX_SOCKET;
  const t = (...a: string[]) => execFileSync("tmux", ["-L", socket, ...a], { encoding: "utf8", env }).trim();
  return { root, home, env, t };
}

test("other commands in an agentteam project say to run migrate", () => {
  const { root } = legacyProject();
  mkdirSync(join(root, "src"));
  assert.throws(() => findRoot(join(root, "src")), (e: Error) => e instanceof ConfigError && /\.agentteam\/.*run otterpack migrate there/.test(e.message));
});

test("migrate moves .agentteam/ to .otterpack/, keeps the conversations, and syncs cleanly", () => {
  const { root, home, env } = legacyProject();
  const r = migrate(root, { env, home });
  assert.equal(r.root, root);
  assert.ok(!exists(root, ".agentteam"));
  assert.equal(findRoot(root), root);
  const lock = JSON.parse(read(root, LOCK_FILE)) as Lock;
  assert.deepEqual(Object.keys(lock.files).filter((p) => p.startsWith(".agentteam/")), []);
  assert.ok(".otterpack/personas/product-owner.md" in lock.files);
  // The tasks were rewritten to run otterpack; the moved files were already in place.
  assert.deepEqual(r.sync.written, [".vscode/tasks.json"]);
  assert.match(read(root, ".vscode/tasks.json"), /"command": "otterpack"/);
  assert.doesNotMatch(read(root, ".vscode/tasks.json"), /agentteam/);
  assert.equal(loadSessions(root)["claude-po"].id, "11111111-1111-1111-1111-111111111111");
  // A second sync has nothing to do.
  assert.deepEqual(sync(root, { home }).written, []);
});

test("after migrate, a seat's next start carries one re-brief saying its folder moved", () => {
  const { root, home, env } = legacyProject();
  migrate(root, { env, home });
  const team = loadTeam(root);
  const seat = team.seats[0];
  const changes = briefChanges(loadSessions(root)["claude-po"].brief!, briefOf(team, seat, root));
  assert.deepEqual(changes, [FOLDER_MOVED], "the persona is unchanged: only the move is reported");
  assert.equal(rebriefNotice(root), "1 seat's brief changed (claude-po): it gets a re-brief when it next starts; otterpack status says more.");
  const text = renderRebrief(team, seat, root, changes);
  assert.match(text, /1\. \.otterpack\/personas\/product-owner\.md/);
  assert.match(text, /Your seat folder is now \.otterpack\/seats\/claude-po\/: keep your notes there, not in \.agentteam\//);
});

test("migrate stops the project's running seats first, and leaves other projects' alone", () => {
  const { root, home, env, t } = legacyProject();
  t("new-session", "-d", "-s", "claude-po", "-c", root, "sleep 600");
  t("set-option", "-t", "=claude-po:", tmux.LEGACY_ROOT_OPTION, root);
  t("new-session", "-d", "-s", "claude-xx", "-c", "/", "sleep 600");
  t("set-option", "-t", "=claude-xx:", tmux.LEGACY_ROOT_OPTION, "/elsewhere");
  const lines: string[] = [];
  const r = migrate(root, { env, home, onLine: (l) => lines.push(l) });
  assert.deepEqual(r.stopped, ["claude-po"]);
  assert.deepEqual(lines, ["claude-po: stopped, conversation kept", "moved .agentteam/ to .otterpack/"]);
  assert.equal(t("list-sessions", "-F", "#{session_name}"), "claude-xx");
  assert.equal(tmux.owner(tmux.tmuxFor(env), "claude-xx", root).owner, "other", "the legacy mark still tells projects apart");
});

test("migrate refuses when there is nothing to move, or both folders exist", () => {
  const lib = libraryRepo(LIB);
  const fresh = project(TEAM(lib));
  assert.throws(() => migrate(fresh, { home: fakeHome() }), /no \.agentteam\/team\.yaml found .*nothing to migrate/);
  const { root, home, env } = legacyProject();
  mkdirSync(join(root, ".otterpack"));
  assert.throws(() => migrate(root, { env, home }), /has both \.agentteam\/ and \.otterpack\//);
  assert.ok(exists(root, ".agentteam/team.yaml"), "nothing was moved");
});
