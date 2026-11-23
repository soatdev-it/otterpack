// otterpack up: start or attach each seat in tmux. Behaviours:
// one lock for setup, the tmux-resurrect restore when the server starts, relaunch of a
// bare shell, the launch typed into a shell (so a shell remains when the harness exits),
// and attach at the end for a single seat.
import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigError, loadTeam, seatOf, type Seat } from "./config.ts";
import { acquire } from "./lock.ts";
import { decide, describe } from "./launch.ts";
import { loadSessions } from "./sessions.ts";
import { syncProblem } from "./sync.ts";
import * as tmux from "./tmux.ts";

export interface UpOptions {
  env?: NodeJS.ProcessEnv;
  attach?: boolean;
  dryRun?: boolean;
  /** argv that runs this CLI (default: the running node + script). Typed into seat shells. */
  self?: string[];
  /** Called for each report line as it happens (before attaching). */
  onLine?: (line: string) => void;
}

export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_\/.,:=+@%-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function selfArgv(): string[] {
  return [process.execPath, ...process.execArgv, process.argv[1]];
}

function launchLine(self: string[], root: string, seat: Seat): string {
  return [...self, "launch", seat.id, "--root", root].map(shellQuote).join(" ");
}

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type State = "running" | "bare shell" | "stopped" | "other project" | "disabled";

export function stateOf(t: tmux.Tmux, id: string, root: string): { state: State; cmd?: string; where?: string } {
  const o = tmux.owner(t, id, root);
  if (o.owner === "none") return { state: "stopped" };
  if (o.owner === "other") return { state: "other project", where: o.where };
  const cmd = tmux.paneCommand(t, id);
  return { state: tmux.SHELLS.has(cmd) ? "bare shell" : "running", cmd };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After typing the launch: wait (up to 5 s) until the pane runs something other than the shell. */
async function waitStarted(t: tmux.Tmux, id: string): Promise<void> {
  const end = Date.now() + 5_000;
  while (Date.now() < end) {
    if (!tmux.SHELLS.has(tmux.paneCommand(t, id))) return;
    await sleep(50);
  }
}

export async function up(root: string, seatIds: string[], opts: UpOptions = {}): Promise<string[]> {
  const env = opts.env ?? process.env;
  const home = env.HOME ?? "";
  const t = tmux.tmuxFor(env);
  const team = loadTeam(root);
  const named = seatIds.map((id) => seatOf(team, id));
  const off = named.find((s) => s.disabled);
  if (off) throw new ConfigError(`${off.id} is disabled: otterpack enable ${off.id} first`);
  const disabled = seatIds.length ? [] : team.seats.filter((s) => s.disabled);
  const seats = seatIds.length ? named : team.seats.filter((s) => !s.disabled);
  // Seats started from an unsynced team.yaml would miss their persona, tasks or kits.
  // Running seats are only attached to, so they don't need a sync.
  const unsynced = syncProblem(root);
  if (unsynced && !opts.dryRun) {
    const server = tmux.serverRunning(t);
    if (seats.some((s) => !server || stateOf(t, s.id, root).state !== "running")) throw new ConfigError(unsynced);
  }
  const self = opts.self ?? selfArgv();
  const lines: string[] = [];
  const say = (l: string) => {
    opts.onLine?.(l);
    lines.push(l);
  };
  const noop = (line: string) => (t.rehearsal ? `: ${line}` : line);
  const launcherProblem = (s: Seat) =>
    s.launcher && !executable(join(root, s.launcher)) ? `launcher ${s.launcher} is missing or not executable` : undefined;

  const skipped = new Set<string>();
  const otherLine = (s: Seat, where?: string) =>
    `${s.id}: the tmux session "${s.id}" belongs to another project (${where}), left alone. Stop it there, or give this seat another id`;

  if (opts.dryRun) {
    if (unsynced) say(`warning: ${unsynced}; seats can't be started until then`);
    for (const s of disabled) say(`${s.id}  disabled  (otterpack enable ${s.id} to start it again)`);
    const sessions = loadSessions(root);
    const running = tmux.serverRunning(t);
    const w = Math.max(...seats.map((s) => s.id.length));
    for (const s of seats) {
      const { state, cmd, where } = running ? stateOf(t, s.id, root) : { state: "stopped" as State, cmd: undefined, where: undefined };
      const plan = launcherProblem(s) ? `STOP: ${launcherProblem(s)}` : describe(decide(root, team, s, home));
      const action =
        state === "other project" ? `left alone: a session of another project (${where})` :
        state === "running" ? `would attach only (${cmd})` :
        state === "bare shell" ? `would type the launch into the shell; ${plan}` :
        `would create the session and launch; ${plan}`;
      const conv = sessions[s.id]?.id || "-";
      say(`${s.id.padEnd(w)}  ${state.padEnd(10)}  ${s.harness.padEnd(6)}  ${conv.padEnd(36)}  ${action}`);
    }
    return lines;
  }

  // The kernel holds this lock (flock): it can't outlive this process.
  const release = await acquire(join(tmpdir(), `otterpack-up-${t.socket ?? "default"}-${process.getuid?.() ?? 0}.lock`));
  try {
    if (!tmux.serverRunning(t)) {
      // First seat after a restart: restore the last saved layout once.
      tmux.newSession(t, "_team_boot", "_team_boot", root);
      const restore = join(home, ".tmux/plugins/tmux-resurrect/scripts/restore.sh");
      // Not in a rehearsal: it would bring the real saved sessions onto the test socket.
      if (!t.rehearsal && existsSync(restore) && executable(restore)) {
        tmux.runShell(t, restore);
        say("tmux server started and last save restored");
      }
      tmux.killSession(t, "_team_boot");
    }
    for (const s of disabled) say(`${s.id}: disabled, not started`);
    for (const s of seats) {
      const problem = launcherProblem(s);
      if (problem) {
        say(`${s.id}: ${problem}, not started`);
        continue;
      }
      const cwd = join(root, s.cwd);
      const line = noop(launchLine(self, root, s));
      const { state, cmd, where } = stateOf(t, s.id, root);
      if (state === "other project") {
        say(otherLine(s, where));
        skipped.add(s.id);
        continue;
      }
      if (state === "stopped") {
        tmux.newSession(t, s.id, s.label, cwd);
        tmux.markSession(t, s.id, root);
        tmux.typeLine(t, s.id, line);
        say(`${s.id}: created and launched`);
      } else if (state === "bare shell") {
        tmux.markSession(t, s.id, root);
        tmux.typeLine(t, s.id, `cd ${shellQuote(cwd)} && ${line}`);
        say(`${s.id}: bare shell, relaunched`);
      } else {
        say(`${s.id}: already running (${cmd}), attaching only${unsynced ? ` (warning: ${unsynced})` : ""}`);
        continue;
      }
      // Hold the lock until the launch is running, so a second `up` of the same seat
      // sees it running instead of typing the launch again into the harness's input.
      if (!t.rehearsal) await waitStarted(t, s.id);
    }
  } finally {
    release();
  }

  if (opts.attach) {
    if (seats.length === 1) {
      if (!skipped.has(seats[0].id)) tmux.attach(t, seats[0].id);
    }
    else say(`not attaching: ${seats.length} seats (name one seat to attach to it)`);
  }
  return lines;
}
