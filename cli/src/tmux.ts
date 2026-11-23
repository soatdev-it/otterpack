// tmux, called directly. Socket selection keeps tests and rehearsals off the real seats:
//   TEAM_TMUX_SOCKET=<name>       tmux -L <name>, and the launch line is typed as a no-op
//                                 (for restart drills);
//                                 no ~/.tmux.conf and no tmux-resurrect restore
//   OTTERPACK_TMUX_SOCKET=<name>  tmux -L <name>, launches for real (tests use this)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface Tmux {
  socket?: string;
  rehearsal: boolean;
  env: NodeJS.ProcessEnv;
}

export function tmuxFor(env: NodeJS.ProcessEnv): Tmux {
  if (env.TEAM_TMUX_SOCKET) return { socket: env.TEAM_TMUX_SOCKET, rehearsal: true, env };
  if (env.OTTERPACK_TMUX_SOCKET) return { socket: env.OTTERPACK_TMUX_SOCKET, rehearsal: false, env };
  return { rehearsal: false, env };
}

export function socketArgs(t: Tmux): string[] {
  // A rehearsal server doesn't load ~/.tmux.conf: its plugins (continuum's auto-save)
  // must not write the rehearsal layout over the real save.
  if (t.rehearsal) return ["-L", t.socket!, "-f", "/dev/null"];
  return t.socket ? ["-L", t.socket] : [];
}

export function run(t: Tmux, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("tmux", [...socketArgs(t), ...args], { env: t.env, encoding: "utf8" });
  if (r.error) throw new Error(`tmux could not be started: ${r.error.message}`);
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function must(t: Tmux, args: string[]): string {
  const r = run(t, args);
  if (!r.ok) throw new Error(`tmux ${args.join(" ")} failed: ${r.err}`);
  return r.out;
}

export const serverRunning = (t: Tmux) => run(t, ["list-sessions"]).ok;
export const hasSession = (t: Tmux, s: string) => run(t, ["has-session", "-t", `=${s}:`]).ok;
export const paneCommand = (t: Tmux, s: string) => must(t, ["display-message", "-p", "-t", `=${s}:`, "#{pane_current_command}"]);
export const newSession = (t: Tmux, s: string, window: string, cwd: string) => must(t, ["new-session", "-d", "-s", s, "-n", window, "-c", cwd]);
export const killSession = (t: Tmux, s: string) => run(t, ["kill-session", "-t", `=${s}`]);
export const runShell = (t: Tmux, cmd: string) => must(t, ["run-shell", cmd]);
/** -l: the text is typed literally, then Enter is sent on its own. */
export function typeLine(t: Tmux, s: string, line: string): void {
  must(t, ["send-keys", "-t", `=${s}:`, "-l", line]);
  must(t, ["send-keys", "-t", `=${s}:`, "Enter"]);
}

export const SHELLS = new Set(["bash", "sh", "zsh", "dash", "fish"]);

export function attach(t: Tmux, s: string): number {
  // Inside tmux already (rare from a VS Code task): switch instead of nesting.
  const args = t.env.TMUX ? ["switch-client", "-t", `=${s}`] : ["attach-session", "-t", `=${s}`];
  const r = spawnSync("tmux", [...socketArgs(t), ...args], { env: t.env, stdio: "inherit" });
  return r.status ?? 1;
}

// Seat ids are plain session names on the user's tmux server, so two projects can both
// have a "claude-po". up marks the sessions it makes with the project root; a session with
// no mark (restored by tmux-resurrect, or made by an older otterpack) counts as this
// project's if it was started inside it. Sessions made under the old name carry the
// legacy mark, which counts the same.
export const ROOT_OPTION = "@otterpack_root";
export const LEGACY_ROOT_OPTION = "@agentteam_root";
export const markSession = (t: Tmux, s: string, root: string) => must(t, ["set-option", "-t", `=${s}:`, ROOT_OPTION, root]);

const markOf = (t: Tmux, s: string, option: string) => run(t, ["show-options", "-v", "-t", `=${s}:`, option]);

export type Owner = "none" | "ours" | "other";
export function owner(t: Tmux, s: string, root: string): { owner: Owner; where?: string } {
  if (!hasSession(t, s)) return { owner: "none" };
  let mark = markOf(t, s, ROOT_OPTION);
  if (!(mark.ok && mark.out)) mark = markOf(t, s, LEGACY_ROOT_OPTION);
  const where = mark.ok && mark.out ? mark.out : run(t, ["display-message", "-p", "-t", `=${s}:`, "#{session_path}"]).out;
  const inside = where === root || where.startsWith(root.endsWith("/") ? root : `${root}/`);
  return { owner: mark.ok && mark.out ? (mark.out === root ? "ours" : "other") : inside ? "ours" : "other", where };
}

/** The pids above this process (Linux /proc; empty elsewhere). */
function ancestors(): Set<number> {
  const out = new Set<number>();
  let pid = process.pid;
  for (let i = 0; i < 64 && pid > 1; i++) {
    out.add(pid);
    const stat = `/proc/${pid}/stat`;
    if (!existsSync(stat)) break;
    // the comm field (2) may hold spaces: the ppid is the 2nd field after the last ")"
    const text = readFileSync(stat, "utf8");
    const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
    pid = Number(rest[1]);
  }
  return out;
}

/** Which of these sessions this process runs inside, if any (a command typed in a seat's pane). */
export function sessionOfSelf(t: Tmux, candidates: string[]): string | undefined {
  const mine = ancestors();
  for (const s of candidates) {
    if (!hasSession(t, s)) continue;
    const pids = run(t, ["list-panes", "-s", "-t", `=${s}`, "-F", "#{pane_pid}"]).out.split("\n").map(Number);
    if (pids.some((p) => mine.has(p))) return s;
  }
  return undefined;
}
