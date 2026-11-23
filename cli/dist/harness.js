// Claude Code and Codex, coded directly (docs/design.md: no abstraction before the second implementation).
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
const CODEX_NO_UPDATE = ["-c", "check_for_update_on_startup=false"];
function promptOf(mode) {
    const p = mode.kind === "first" ? mode.kickoff : mode.prompt;
    return p ? [p] : [];
}
export function launchArgv(seat, root, mode) {
    if (seat.launcher) {
        // The launcher script gets --resume <id> or --session-id <id>, --name <label>, then the kickoff or re-brief.
        const idArgs = mode.kind === "resume" ? ["--resume", mode.id] : mode.id ? ["--session-id", mode.id] : [];
        const prompt = promptOf(mode);
        return { cmd: join(root, seat.launcher), args: [...seat.args, ...idArgs, "--name", seat.label, ...prompt] };
    }
    // A seat in a subfolder: its seat folder (under the project root) is outside its cwd.
    const extra = seat.cwd === "." ? [] : ["--add-dir", join(root, ".otterpack/seats", seat.id)];
    if (seat.harness === "claude") {
        const base = [...extra, ...seat.args, "--name", seat.label];
        if (mode.kind === "resume")
            return { cmd: "claude", args: [...base, "--resume", mode.id, ...promptOf(mode)] };
        if (!mode.id)
            throw new Error("a Claude first launch needs a session id");
        return { cmd: "claude", args: [...base, "--session-id", mode.id, ...(mode.kickoff ? [mode.kickoff] : [])] };
    }
    if (mode.kind === "resume")
        return { cmd: "codex", args: ["resume", ...CODEX_NO_UPDATE, ...extra, ...seat.args, mode.id, ...promptOf(mode)] };
    return { cmd: "codex", args: [...CODEX_NO_UPDATE, ...extra, ...seat.args, ...(mode.kickoff ? [mode.kickoff] : [])] };
}
/** Claude names the transcript after the session id, under a folder named after the cwd. */
export function findClaudeTranscript(home, id) {
    const projects = join(home, ".claude", "projects");
    if (!existsSync(projects))
        return undefined;
    for (const dir of readdirSync(projects)) {
        const f = join(projects, dir, `${id}.jsonl`);
        if (existsSync(f))
            return f;
    }
    return undefined;
}
function firstLine(file) {
    const fd = openSync(file, "r");
    try {
        const buf = Buffer.alloc(64 * 1024);
        const n = readSync(fd, buf, 0, buf.length, 0);
        return buf.subarray(0, n).toString("utf8").split("\n")[0];
    }
    finally {
        closeSync(fd);
    }
}
function rollouts(dir, out) {
    if (!existsSync(dir))
        return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory())
            rollouts(p, out);
        else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl"))
            out.push(p);
    }
}
/**
 * Codex has no --session-id. Its rollout files are grouped by date, not project, so the
 * conversation is the one whose session_meta has the seat cwd and that contains the marker.
 * Only files modified since `sinceMs` are read.
 */
export function findCodexRollout(home, cwd, marker, sinceMs) {
    const files = [];
    rollouts(join(home, ".codex", "sessions"), files);
    for (const f of files) {
        if (statSync(f).mtimeMs < sinceMs)
            continue;
        let meta;
        try {
            meta = JSON.parse(firstLine(f));
        }
        catch {
            continue;
        }
        if (meta?.type !== "session_meta" || meta.payload?.cwd !== cwd || typeof meta.payload?.id !== "string")
            continue;
        if (readFileSync(f, "utf8").includes(marker))
            return meta.payload.id;
    }
    return undefined;
}
/**
 * Whether Codex still has the conversation `id` on disk: true or false when Codex keeps
 * rollout files here, undefined when it keeps none we can see (nothing to check against).
 */
export function codexConversationExists(home, id) {
    const dirs = [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")].filter((d) => existsSync(d));
    if (!dirs.length)
        return undefined;
    const files = [];
    for (const d of dirs)
        rollouts(d, files);
    return files.some((f) => f.endsWith(`-${id}.jsonl`));
}
