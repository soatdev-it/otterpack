// otterpack update: move the pin to the library's latest commit, show what changes, sync.
import { homedir } from "node:os";
import { loadTeam } from "./config.js";
import { latestCommit, libraryLog, librarySource } from "./library.js";
import { readLock, sync } from "./sync.js";
export function update(root, opts = {}) {
    const home = opts.home ?? homedir();
    const team = loadTeam(root);
    const source = librarySource(team.library, root);
    const from = readLock(root)?.library.commit;
    const to = latestCommit(source, home);
    // The log first: sync is the last step, so nothing after it can fail half-way.
    let log = [];
    if (from) {
        try {
            log = libraryLog(source, from, to, home);
        }
        catch {
            log = ["(the old pin is not in this library's history)"];
        }
    }
    // sync writes nothing and keeps the old lock if anything is in the way.
    const r = sync(root, { home, commit: to });
    return { from, to, log, written: r.written, removed: r.removed, adopted: r.adopted };
}
