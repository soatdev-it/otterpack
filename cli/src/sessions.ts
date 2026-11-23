// Seat -> conversation id. One file per seat in .otterpack/state/sessions/<seat>.json
// (gitignored, in the workspace, so it survives a container rebuild with no extra mount).
// Each seat's launch process writes only its own file, atomically, so no lock is needed.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "./config.ts";
import type { Brief } from "./kickoff.ts";

export interface SessionEntry {
  harness: Harness;
  /** "" for a Codex first launch whose conversation hasn't been found yet. */
  id: string;
  /** false until the harness has written the conversation. */
  confirmed: boolean;
  /** What the seat was last told to read; absent for an entry written before briefs existed. */
  brief?: Brief;
}

export type Sessions = Record<string, SessionEntry>;

export const STATE_DIR = ".otterpack/state";
export const SESSIONS_DIR = `${STATE_DIR}/sessions`;
export const sessionFile = (root: string, seat: string) => join(root, SESSIONS_DIR, `${seat}.json`);

export function loadSessions(root: string): Sessions {
  const dir = join(root, SESSIONS_DIR);
  const out: Sessions = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      /* a half-written tmp file can't exist (rename is atomic); skip anything unreadable */
    }
  }
  return out;
}

export function setSession(root: string, seat: string, entry: SessionEntry): void {
  mkdirSync(join(root, SESSIONS_DIR), { recursive: true });
  const f = sessionFile(root, seat);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
  renameSync(tmp, f);
}

export function clearSession(root: string, seat: string): void {
  rmSync(sessionFile(root, seat), { force: true });
}
