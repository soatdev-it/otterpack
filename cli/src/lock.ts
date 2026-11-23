// The setup lock for `up`, held by the kernel (flock(1)): a small `flock`
// child holds it and exits when our stdin pipe closes, so the lock goes away with this
// process however it dies (crash, SIGHUP, SIGKILL), pid reuse can't keep it, and no tmux
// server started meanwhile can inherit it.
// The holder writes who it is into the lock file, so a timed-out wait can name it.
import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";

export class LockError extends Error {}

interface Holder { pid: number; what: string; since: string }

function noted(path: string): Holder | undefined {
  try {
    const h = JSON.parse(readFileSync(path, "utf8")) as Holder;
    return h && typeof h.pid === "number" ? h : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The process holding the lock, from the kernel (Linux /proc/locks): the flock(1) process,
 * and the process that started it. It names a holder that wrote no note (an otterpack
 * older than 0.6.1), and is never fooled by a note a previous holder left behind.
 */
function kernelHolder(path: string): { flock: number; parent: number; cmd: string } | undefined {
  try {
    const ino = statSync(path).ino;
    const line = readFileSync("/proc/locks", "utf8")
      .split("\n")
      .find((l) => !l.includes("->") && /\bFLOCK\b/.test(l) && l.trim().split(/\s+/)[5]?.endsWith(`:${ino}`));
    if (!line) return undefined;
    const flock = Number(line.trim().split(/\s+/)[4]);
    const stat = readFileSync(`/proc/${flock}/stat`, "utf8");
    const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const cmd = readFileSync(`/proc/${parent}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    return { flock, parent, cmd: cmd.length > 160 ? `${cmd.slice(0, 157)}...` : cmd };
  } catch {
    return undefined;
  }
}

function holderOf(path: string): string {
  const note = noted(path);
  const k = kernelHolder(path);
  if (note && (!k || k.parent === note.pid)) {
    const secs = Math.round((Date.now() - Date.parse(note.since)) / 1000);
    return `. It is held by pid ${note.pid} (${note.what}), for ${secs}s now. If that process is stuck, stop it (kill ${note.pid}), then try again`;
  }
  if (k) {
    return (
      `. It is held by pid ${k.parent} (${k.cmd || "command unknown"}), through its flock process ${k.flock}. ` +
      `That holder doesn't say what it is doing: an otterpack older than 0.6.1, still running in a terminal VS Code kept open, does that. ` +
      `kill ${k.flock} frees the lock (a seat that process is attached to keeps running), then try again`
    );
  }
  return "";
}

/**
 * `what` says who holds the lock, for anyone left waiting on it. The release resolves once
 * the flock child has exited, so the lock is really free: await it before anything that
 * blocks this process (a `tmux attach` does, for as long as the terminal stays open, and
 * the pipe to the child only closes on the event loop).
 */
export function acquire(path: string, timeoutMs = 60_000, what = "otterpack"): Promise<() => Promise<void>> {
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
      try {
        writeFileSync(path, JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }) + "\n");
      } catch {
        /* only a diagnostic: the lock itself is held either way */
      }
      resolve(
        () =>
          new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) return done();
            child.once("exit", () => done());
            child.stdin.end();
            // Should closing the pipe not end it, the lock must still go.
            setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
          }),
      );
    });
    child.on("error", (e: any) =>
      reject(new LockError(e.code === "ENOENT" ? "flock is not installed (util-linux); otterpack up needs it" : `flock: ${e.message}`)),
    );
    child.on("exit", (code) => {
      if (!held) reject(new LockError(code === 1 ? `timed out after ${timeoutMs / 1000}s waiting for the lock ${path}${holderOf(path)}` : `flock failed (${code}): ${err.trim()}`));
    });
  });
}
