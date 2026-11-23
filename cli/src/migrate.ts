// otterpack migrate: move a project from agentteam (otterpack's old name) to otterpack.
// It stops the project's running seats (their conversations are kept), renames
// .agentteam/ to .otterpack/, points lock.json at the new paths, and syncs, which
// rewrites the generated files that name the command (the VS Code tasks). Each seat's
// next start resumes its conversation with a re-brief saying where its files went.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, findLegacyRoot, LEGACY_DIR, parseTeam, TEAM_DIR } from "./config.ts";
import { LOCK_FILE, sync, writeAtomic, type Lock, type SyncResult } from "./sync.ts";
import * as tmux from "./tmux.ts";

export interface MigrateOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  onLine?: (line: string) => void;
}

export interface MigrateResult {
  root: string;
  stopped: string[];
  sync: SyncResult;
}

const moved = (p: string) => (p.startsWith(`${LEGACY_DIR}/`) ? TEAM_DIR + p.slice(LEGACY_DIR.length) : p);
const movedKeys = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([p, h]) => [moved(p), h]));

export function migrate(from: string = process.cwd(), opts: MigrateOptions = {}): MigrateResult {
  const root = findLegacyRoot(from);
  if (!root) throw new ConfigError(`no ${LEGACY_DIR}/team.yaml found in ${from} or any parent folder: nothing to migrate`);
  if (existsSync(join(root, TEAM_DIR))) {
    throw new ConfigError(`${root} has both ${LEGACY_DIR}/ and ${TEAM_DIR}/: keep one (move or delete the other by hand), then run otterpack sync`);
  }
  const team = parseTeam(readFileSync(join(root, LEGACY_DIR, "team.yaml"), "utf8"), root);

  // Stop the seats first: a running seat would keep writing to .agentteam/.
  const t = tmux.tmuxFor(opts.env ?? process.env);
  const ours = team.seats.map((s) => s.id).filter((id) => tmux.owner(t, id, root).owner === "ours");
  if (tmux.sessionOfSelf(t, ours)) {
    throw new ConfigError("migrate stops the seats, this one included: run it from a terminal outside the seats");
  }
  const stopped: string[] = [];
  for (const id of ours) {
    if (tmux.killSession(t, id).ok) {
      stopped.push(id);
      opts.onLine?.(`${id}: stopped, conversation kept`);
    }
  }

  renameSync(join(root, LEGACY_DIR), join(root, TEAM_DIR));
  opts.onLine?.(`moved ${LEGACY_DIR}/ to ${TEAM_DIR}/`);

  const lockPath = join(root, LOCK_FILE);
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
    const next: Lock = { ...lock, files: movedKeys(lock.files) };
    if (lock.pending) next.pending = movedKeys(lock.pending);
    writeAtomic(lockPath, JSON.stringify(next, null, 2) + "\n");
  }
  return { root, stopped, sync: sync(root, { home: opts.home }) };
}
