// The setup lock for `up`, held by the kernel (flock(1)): a small `flock`
// child holds it and exits when our stdin pipe closes, so the lock goes away with this
// process however it dies (crash, SIGHUP, SIGKILL), pid reuse can't keep it, and no tmux
// server started meanwhile can inherit it.
// The holder writes who it is into the lock file, so a timed-out wait can name it.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
export class LockError extends Error {
}
function holderOf(path) {
    let h;
    try {
        h = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return "";
    }
    if (!h || typeof h.pid !== "number")
        return "";
    const secs = Math.round((Date.now() - Date.parse(h.since)) / 1000);
    return `. It is held by pid ${h.pid} (${h.what}), for ${secs}s now. If that process is stuck, stop it (kill ${h.pid}), then try again`;
}
/**
 * `what` says who holds the lock, for anyone left waiting on it. The release resolves once
 * the flock child has exited, so the lock is really free: await it before anything that
 * blocks this process (a `tmux attach` does, for as long as the terminal stays open, and
 * the pipe to the child only closes on the event loop).
 */
export function acquire(path, timeoutMs = 60_000, what = "otterpack") {
    return new Promise((resolve, reject) => {
        const child = spawn("flock", ["-w", String(Math.ceil(timeoutMs / 1000)), path, "sh", "-c", "echo locked; exec cat >/dev/null"], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        let err = "";
        let held = false;
        child.stderr.on("data", (d) => (err += d));
        child.stdout.on("data", (d) => {
            if (held || !String(d).includes("locked"))
                return;
            held = true;
            try {
                writeFileSync(path, JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }) + "\n");
            }
            catch {
                /* only a diagnostic: the lock itself is held either way */
            }
            resolve(() => new Promise((done) => {
                if (child.exitCode !== null || child.signalCode !== null)
                    return done();
                child.once("exit", () => done());
                child.stdin.end();
                // Should closing the pipe not end it, the lock must still go.
                setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
            }));
        });
        child.on("error", (e) => reject(new LockError(e.code === "ENOENT" ? "flock is not installed (util-linux); otterpack up needs it" : `flock: ${e.message}`)));
        child.on("exit", (code) => {
            if (!held)
                reject(new LockError(code === 1 ? `timed out after ${timeoutMs / 1000}s waiting for the lock ${path}${holderOf(path)}` : `flock failed (${code}): ${err.trim()}`));
        });
    });
}
