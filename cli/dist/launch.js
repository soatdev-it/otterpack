// otterpack launch <seat>: what `up` types into a seat's shell. Decides resume, first
// launch or stop; runs the harness in the foreground; records the conversation id.
// Rule (docs/design.md, Resume): a conversation that can't be resumed stops with a message. It is
// never silently replaced by a new one.
import { spawn } from "node:child_process";
import { ensureSeatFolder } from "./sync.js";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { loadTeam, seatOf } from "./config.js";
import { codexConversationExists, findClaudeTranscript, findCodexRollout, launchArgv } from "./harness.js";
import * as tmux from "./tmux.js";
import { briefChanges, briefOf, marker, renderKickoff, renderRebrief } from "./kickoff.js";
import { clearSession, loadSessions, sessionFile, setSession, SESSIONS_DIR } from "./sessions.js";
/** Pure: what launching this seat now would do. Shared by launch and `up --dry-run`. */
export function decide(root, team, seat, home) {
    const entry = loadSessions(root)[seat.id];
    const file = `${SESSIONS_DIR}/${seat.id}.json`;
    if (!entry)
        return { kind: "first" };
    if (entry.harness !== seat.harness) {
        return { kind: "stop", reason: `${file} holds a ${entry.harness} conversation, but the seat is ${seat.harness}. Delete that file to start a new conversation.` };
    }
    if (seat.harness === "claude") {
        if (findClaudeTranscript(home, entry.id))
            return { kind: "resume", id: entry.id };
        if (!entry.confirmed)
            return { kind: "first", id: entry.id };
        return { kind: "stop", reason: `conversation ${entry.id} not found in ~/.claude/projects. Not starting a new one in its place. To start fresh, delete ${file}.` };
    }
    if (!entry.id) {
        return {
            kind: "stop",
            reason: `the first Codex conversation of ${seat.id} was not found (no rollout in ~/.codex/sessions with the marker ${marker(team, seat)}). ` +
                `Not starting another one. Find it with \`codex resume\` (the picker) and put its id in ${file}, or delete that file to start a new conversation.`,
        };
    }
    if (codexConversationExists(home, entry.id) === false) {
        return { kind: "stop", reason: `Codex conversation ${entry.id} not found in ~/.codex/sessions. Not starting a new one in its place. To start fresh, delete ${file}.` };
    }
    return { kind: "resume", id: entry.id };
}
export function describe(d) {
    if (d.kind === "resume")
        return `resume ${d.id}`;
    if (d.kind === "first")
        return d.id ? `first launch again (no message yet in ${d.id})` : "new conversation";
    return `STOP: ${d.reason}`;
}
export async function launch(root, seatId, opts = {}) {
    const env = opts.env ?? process.env;
    // up marked this seat as starting when it typed this line: it is running now.
    tmux.clearLaunching(env);
    const say = opts.stderr ?? ((s) => process.stderr.write(s));
    const home = env.HOME ?? "";
    const team = loadTeam(root);
    const seat = seatOf(team, seatId);
    const cwd = join(root, seat.cwd);
    ensureSeatFolder(root, seat.id); // a fresh checkout has no empty folders
    const d = decide(root, team, seat, home);
    if (d.kind === "stop") {
        say(`otterpack: ${seat.id}: ${d.reason}\n`);
        return 1;
    }
    let mode;
    let discover; // true once the id is recorded
    // Recorded with every launch: what the seat is told to read now. A resumed seat whose
    // brief changed since (persona, charter or addendum) gets a re-brief as its prompt, once.
    const brief = briefOf(team, seat, root);
    if (d.kind === "resume") {
        const entry = loadSessions(root)[seat.id];
        const changes = entry?.brief ? briefChanges(entry.brief, brief) : [];
        setSession(root, seat.id, { harness: seat.harness, id: d.id, confirmed: seat.harness === "claude" ? true : entry.confirmed, brief });
        mode = { kind: "resume", id: d.id };
        if (changes.length) {
            mode.prompt = renderRebrief(team, seat, root, changes);
            say(`otterpack: ${seat.id}: its brief changed (${changes.join("; ")}); resuming with a re-brief.\n`);
        }
    }
    else if (seat.harness === "claude") {
        const id = d.id ?? randomUUID();
        setSession(root, seat.id, { harness: "claude", id, confirmed: false, brief });
        mode = { kind: "first", id, kickoff: renderKickoff(team, seat, root) };
        discover = () => {
            if (!findClaudeTranscript(home, id))
                return false;
            setSession(root, seat.id, { harness: "claude", id, confirmed: true, brief });
            return true;
        };
    }
    else {
        // Recorded before the launch: if the conversation is never found, the next launch
        // stops with a message instead of starting yet another one.
        setSession(root, seat.id, { harness: "codex", id: "", confirmed: false, brief });
        const kickoff = renderKickoff(team, seat, root);
        mode = { kind: "first", kickoff };
        const since = Date.now() - 5_000;
        const mark = marker(team, seat);
        const cwds = new Set([cwd]);
        try {
            cwds.add(realpathSync(cwd));
        }
        catch { /* spawn reports a missing cwd */ }
        discover = () => {
            for (const c of cwds) {
                const id = findCodexRollout(home, c, mark, since);
                if (id) {
                    setSession(root, seat.id, { harness: "codex", id, confirmed: true, brief });
                    return true;
                }
            }
            return false;
        };
        if (!kickoff)
            say(`otterpack: ${seat.id} has no persona, so its first message carries no marker; record its conversation id in ${sessionFile(root, seat.id)} by hand.\n`);
    }
    const argv = launchArgv(seat, root, mode);
    return new Promise((resolve) => {
        const child = spawn(argv.cmd, argv.args, { cwd, env, stdio: "inherit" });
        // Ctrl-C belongs to the harness; this process only waits for it.
        const ignore = () => { };
        process.on("SIGINT", ignore);
        process.on("SIGQUIT", ignore);
        let found = false;
        const check = () => {
            if (!found && discover)
                found = discover();
        };
        // Poll for as long as the harness runs: a trust dialog can hold the first message back.
        const timer = discover ? setInterval(check, 500) : undefined;
        let settled = false;
        const done = (code) => {
            if (settled)
                return;
            settled = true;
            clearInterval(timer);
            process.off("SIGINT", ignore);
            process.off("SIGQUIT", ignore);
            if (discover && !found && seat.harness === "codex") {
                say(`otterpack: ${seat.id}: the Codex conversation was not found; the next launch will stop and say how to record it.\n`);
            }
            resolve(code);
        };
        child.on("error", (e) => {
            // Nothing started: don't leave a "not found yet" Codex entry that blocks the next launch.
            if (seat.harness === "codex" && d.kind === "first")
                clearSession(root, seat.id);
            say(e.code === "ENOENT" ? `otterpack: ${argv.cmd} not found (is it installed and on PATH?)\n` : `otterpack: ${argv.cmd}: ${e.message}\n`);
            done(e.code === "ENOENT" ? 127 : 126);
        });
        child.on("exit", (code, signal) => {
            check();
            done(code ?? (signal ? 129 : 1));
        });
    });
}
