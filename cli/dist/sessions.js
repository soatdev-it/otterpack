// Seat -> conversation id. One file per seat in .otterpack/state/sessions/<seat>.json
// (gitignored, in the workspace, so it survives a container rebuild with no extra mount).
// Each seat's launch process writes only its own file, atomically, so no lock is needed.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const STATE_DIR = ".otterpack/state";
export const SESSIONS_DIR = `${STATE_DIR}/sessions`;
export const sessionFile = (root, seat) => join(root, SESSIONS_DIR, `${seat}.json`);
export function loadSessions(root) {
    const dir = join(root, SESSIONS_DIR);
    const out = {};
    if (!existsSync(dir))
        return out;
    for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json"))
            continue;
        try {
            out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
        }
        catch {
            /* a half-written tmp file can't exist (rename is atomic); skip anything unreadable */
        }
    }
    return out;
}
export function setSession(root, seat, entry) {
    mkdirSync(join(root, SESSIONS_DIR), { recursive: true });
    const f = sessionFile(root, seat);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
    renameSync(tmp, f);
}
export function clearSession(root, seat) {
    rmSync(sessionFile(root, seat), { force: true });
}
