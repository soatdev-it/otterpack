// The setup lock for `up`, held by the kernel (flock(1)): a small `flock`
// child holds it and exits when our stdin pipe closes, so the lock goes away with this
// process however it dies (crash, SIGHUP, SIGKILL), pid reuse can't keep it, and no tmux
// server started meanwhile can inherit it.
import { spawn } from "node:child_process";

export class LockError extends Error {}

export function acquire(path: string, timeoutMs = 60_000): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const child = spawn("flock", ["-w", String(Math.ceil(timeoutMs / 1000)), path, "sh", "-c", "echo locked; exec cat >/dev/null"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let err = "";
    let held = false;
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      if (held || !String(d).includes("locked")) return;
      held = true;
      resolve(() => child.stdin.end());
    });
    child.on("error", (e: any) =>
      reject(new LockError(e.code === "ENOENT" ? "flock is not installed (util-linux); otterpack up needs it" : `flock: ${e.message}`)),
    );
    child.on("exit", (code) => {
      if (!held) reject(new LockError(code === 1 ? `timed out after ${timeoutMs / 1000}s waiting for the lock ${path}` : `flock failed (${code}): ${err.trim()}`));
    });
  });
}
