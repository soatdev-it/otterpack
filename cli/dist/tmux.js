// tmux, called directly. Socket selection keeps tests and rehearsals off the real seats:
//   TEAM_TMUX_SOCKET=<name>       tmux -L <name>, and the launch line is typed as a no-op
//                                 (for restart drills);
//                                 no ~/.tmux.conf and no tmux-resurrect restore
//   OTTERPACK_TMUX_SOCKET=<name>  tmux -L <name>, launches for real (tests use this)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
export function tmuxFor(env) {
    if (env.TEAM_TMUX_SOCKET)
        return { socket: env.TEAM_TMUX_SOCKET, rehearsal: true, env };
    if (env.OTTERPACK_TMUX_SOCKET)
        return { socket: env.OTTERPACK_TMUX_SOCKET, rehearsal: false, env };
    return { rehearsal: false, env };
}
export function socketArgs(t) {
    // A rehearsal server doesn't load ~/.tmux.conf: its plugins (continuum's auto-save)
    // must not write the rehearsal layout over the real save.
    if (t.rehearsal)
        return ["-L", t.socket, "-f", "/dev/null"];
    return t.socket ? ["-L", t.socket] : [];
}
export function run(t, args) {
    const r = spawnSync("tmux", [...socketArgs(t), ...args], { env: t.env, encoding: "utf8" });
    if (r.error)
        throw new Error(`tmux could not be started: ${r.error.message}`);
    return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
function must(t, args) {
    const r = run(t, args);
    if (!r.ok)
        throw new Error(`tmux ${args.join(" ")} failed: ${r.err}`);
    return r.out;
}
export const serverRunning = (t) => run(t, ["list-sessions"]).ok;
export const hasSession = (t, s) => run(t, ["has-session", "-t", `=${s}:`]).ok;
export const paneCommand = (t, s) => must(t, ["display-message", "-p", "-t", `=${s}:`, "#{pane_current_command}"]);
export const newSession = (t, s, window, cwd) => must(t, ["new-session", "-d", "-s", s, "-n", window, "-c", cwd]);
export const killSession = (t, s) => run(t, ["kill-session", "-t", `=${s}`]);
export const runShell = (t, cmd) => must(t, ["run-shell", cmd]);
/** -l: the text is typed literally, then Enter is sent on its own. */
export function typeLine(t, s, line) {
    must(t, ["send-keys", "-t", `=${s}:`, "-l", line]);
    must(t, ["send-keys", "-t", `=${s}:`, "Enter"]);
}
export const SHELLS = new Set(["bash", "sh", "zsh", "dash", "fish"]);
export function attach(t, s) {
    // Inside tmux already (rare from a VS Code task): switch instead of nesting.
    const args = t.env.TMUX ? ["switch-client", "-t", `=${s}`] : ["attach-session", "-t", `=${s}`];
    const r = spawnSync("tmux", [...socketArgs(t), ...args], { env: t.env, stdio: "inherit" });
    return r.status ?? 1;
}
// Seat ids are plain session names on the user's tmux server, so two projects can both
// have a "claude-po". up marks the sessions it makes with the project root; a session with
// no mark (restored by tmux-resurrect, for example) counts as this project's if it was
// started inside it.
export const ROOT_OPTION = "@otterpack_root";
export const markSession = (t, s, root) => must(t, ["set-option", "-t", `=${s}:`, ROOT_OPTION, root]);
export function owner(t, s, root) {
    if (!hasSession(t, s))
        return { owner: "none" };
    const mark = run(t, ["show-options", "-v", "-t", `=${s}:`, ROOT_OPTION]);
    const where = mark.ok && mark.out ? mark.out : run(t, ["display-message", "-p", "-t", `=${s}:`, "#{session_path}"]).out;
    const inside = where === root || where.startsWith(root.endsWith("/") ? root : `${root}/`);
    return { owner: mark.ok && mark.out ? (mark.out === root ? "ours" : "other") : inside ? "ours" : "other", where };
}
/** The pids above this process (Linux /proc; empty elsewhere). */
function ancestors() {
    const out = new Set();
    let pid = process.pid;
    for (let i = 0; i < 64 && pid > 1; i++) {
        out.add(pid);
        const stat = `/proc/${pid}/stat`;
        if (!existsSync(stat))
            break;
        // the comm field (2) may hold spaces: the ppid is the 2nd field after the last ")"
        const text = readFileSync(stat, "utf8");
        const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
        pid = Number(rest[1]);
    }
    return out;
}
/** Which of these sessions this process runs inside, if any (a command typed in a seat's pane). */
export function sessionOfSelf(t, candidates) {
    const mine = ancestors();
    for (const s of candidates) {
        if (!hasSession(t, s))
            continue;
        const pids = run(t, ["list-panes", "-s", "-t", `=${s}`, "-F", "#{pane_pid}"]).out.split("\n").map(Number);
        if (pids.some((p) => mine.has(p)))
            return s;
    }
    return undefined;
}
