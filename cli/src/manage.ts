// Team management: add, remove, stop, reset and status. Seats are edited in team.yaml
// (comments and layout kept), then synced; a failed sync puts team.yaml back as it was.
// Only this project's tmux sessions are ever stopped (tmux.owner), and when a command runs
// inside one of the seats it stops, that seat goes last, after everything else is done.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseDocument, isMap, isScalar, isSeq, type Document } from "yaml";
import { ConfigError, loadTeam, parseTeam, seatOf, TEAM_FILE, type Harness, type Seat, type Team } from "./config.ts";
import { sync, syncProblem, SEATS_DIR, type SyncResult } from "./sync.ts";
import { clearSession, loadSessions, type SessionEntry } from "./sessions.ts";
import { briefChanges, briefOf } from "./kickoff.ts";
import { stateOf, type State } from "./up.ts";
import * as tmux from "./tmux.ts";
import { YAML_FORMAT } from "./init.ts";

export interface SeatSpec {
  id: string;
  persona: string;
  label?: string;
  harness?: Harness;
  icon?: string;
  color?: string;
  cwd?: string;
}

interface Opts {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Each result line as it happens, before a seat this command runs in is stopped. */
  onLine?: (line: string) => void;
}

export function reportLines(r: Pick<SyncResult, "commit" | "written" | "removed"> & { adopted?: string[] }): string[] {
  const n = r.adopted?.length ?? 0;
  return [
    `library at ${r.commit.slice(0, 12)}, ${r.written.length} written, ${r.removed.length} removed`,
    ...r.written.map((p) => `  + ${p}`),
    ...r.removed.map((p) => `  - ${p}`),
    ...(n
      ? [`  = ${n} file${n === 1 ? "" : "s"} already there with the content sync writes, now managed by sync (update changes ${n === 1 ? "it" : "them"}, and removing ${n === 1 ? "its" : "their"} kit removes ${n === 1 ? "it" : "them"})`]
      : []),
  ];
}

function editTeam(root: string, home: string | undefined, edit: (doc: Document) => void): SyncResult {
  const path = join(root, TEAM_FILE);
  const before = readFileSync(path, "utf8");
  const doc = parseDocument(before);
  edit(doc);
  const after = doc.toString(YAML_FORMAT);
  parseTeam(after, root); // a bad edit fails here, before anything is written
  writeFileSync(path, after);
  try {
    return sync(root, { home: home ?? homedir() });
  } catch (e) {
    writeFileSync(path, before);
    throw e;
  }
}

function seatsOf(doc: Document) {
  const seats = doc.get("seats");
  if (!isSeq(seats)) throw new ConfigError("team.yaml: seats must be a list");
  return seats;
}

export function addSeat(root: string, spec: SeatSpec, opts: Opts = {}): SyncResult {
  const seat: Record<string, string> = {
    id: spec.id,
    label: spec.label ?? spec.id,
    icon: spec.icon ?? "person",
    color: spec.color ?? "ansiWhite",
    persona: spec.persona,
    harness: spec.harness ?? (/^codex(-|$)/.test(spec.id) ? "codex" : "claude"),
  };
  if (spec.cwd) seat.cwd = spec.cwd;
  return editTeam(root, opts.home, (doc) => seatsOf(doc).add(doc.createNode(seat)));
}

/** Stops the seats' sessions that are this project's, the one this process runs in last. */
function stopSessions(root: string, ids: string[], opts: Opts, line: (id: string, o: tmux.Owner, where?: string) => string): { lines: string[]; stopped: Set<string> } {
  const t = tmux.tmuxFor(opts.env ?? process.env);
  const owners = new Map(ids.map((id) => [id, tmux.owner(t, id, root)]));
  const ours = ids.filter((id) => owners.get(id)!.owner === "ours");
  const self = tmux.sessionOfSelf(t, ours);
  const stopped = new Set<string>();
  const lines: string[] = [];
  const emit = (l: string) => {
    lines.push(l);
    opts.onLine?.(l);
  };
  for (const id of ids) {
    const o = owners.get(id)!;
    if (o.owner === "ours" && id !== self && tmux.killSession(t, id).ok) stopped.add(id);
    if (id !== self) emit(line(id, o.owner, o.where));
  }
  if (self) {
    stopped.add(self);
    emit(line(self, "ours"));
    tmux.killSession(t, self); // this process's own pane goes with it
  }
  return { lines, stopped };
}

const elsewhere = (id: string, where?: string) => `the tmux session "${id}" belongs to another project (${where}), left alone`;

export function stopSeats(root: string, ids: string[], opts: Opts = {}): string[] {
  const team = loadTeam(root);
  const seats = ids.length ? ids.map((id) => seatOf(team, id)) : team.seats;
  const sessions = loadSessions(root);
  return stopSessions(root, seats.map((s) => s.id), opts, (id, o, where) => {
    if (o === "none") return `${id}: not running`;
    if (o === "other") return `${id}: ${elsewhere(id, where)}`;
    const e = sessions[id];
    if (e?.harness === "codex" && !e.id) {
      return `${id}: stopped. Its first Codex conversation was never found, so it can't be resumed: run otterpack reset ${id} before starting it again`;
    }
    return `${id}: stopped, conversation kept (otterpack up ${id}, or the next window reload, starts it again)`;
  }).lines;
}

export function resetSeat(root: string, id: string, opts: Opts = {}): string[] {
  seatOf(loadTeam(root), id);
  clearSession(root, id); // before the stop: the stop may end this very process
  return stopSessions(root, [id], opts, (_, o, where) =>
    o === "other"
      ? `${id}: conversation forgotten; ${elsewhere(id, where)}`
      : `${id}: ${o === "ours" ? "stopped, " : ""}conversation forgotten; the next otterpack up ${id} starts a new one, with the kickoff`,
  ).lines;
}

export function removeSeat(
  root: string,
  id: string,
  opts: Opts & { keepConversation?: boolean } = {},
): { result: SyncResult; stopped: boolean; folder: string } {
  const team = loadTeam(root);
  seatOf(team, id);
  if (team.seats.length === 1) throw new ConfigError(`${id} is the last seat; a team needs at least one (add another seat first)`);
  const result = editTeam(root, opts.home, (doc) => {
    const seats = seatsOf(doc);
    const i = seats.items.findIndex((n) => isMap(n) && n.get("id") === id);
    // The comment above the first item is kept on the list, not on the item.
    if (i === 0) seats.commentBefore = undefined;
    seats.items.splice(i, 1);
  });
  if (!opts.keepConversation) clearSession(root, id);
  const folder = `${SEATS_DIR}/${id}`;
  for (const l of reportLines(result)) opts.onLine?.(l);
  const { stopped } = stopSessions(root, [id], opts, (_, o, where) =>
    `seat ${id} removed${o === "ours" ? " and stopped" : ""}${o === "other" ? ` (${elsewhere(id, where)})` : ""}; ` +
    `its folder ${folder}/ is kept (delete it yourself if you don't need its notes)`,
  );
  return { result, stopped: stopped.has(id), folder };
}

export interface SeatStatus {
  id: string;
  label: string;
  harness: Harness;
  persona: string;
  state: State;
  /** The pane's command when running. */
  command?: string;
  /** Where another project's same-named session runs. */
  where?: string;
  conversation?: string;
  /** Set when the seat has a conversation and its brief changed since it last read it. */
  briefChanges?: string[];
}

export function status(root: string, opts: Opts = {}): { syncProblem?: string; seats: SeatStatus[] } {
  const team = loadTeam(root);
  const sessions = loadSessions(root);
  const t = tmux.tmuxFor(opts.env ?? process.env);
  const server = tmux.serverRunning(t);
  const seats = team.seats.map((s: Seat) => {
    let { state, cmd, where } = server ? stateOf(t, s.id, root) : { state: "stopped" as State, cmd: undefined, where: undefined };
    if (s.disabled && state !== "running" && state !== "bare shell") state = "disabled";
    return {
      id: s.id, label: s.label, harness: s.harness, persona: s.persona, state, command: cmd, where,
      conversation: sessions[s.id]?.id || undefined,
      briefChanges: staleBrief(team, s, root, sessions[s.id]),
    };
  });
  return { syncProblem: syncProblem(root), seats };
}

/** One line for after a sync or update: which seats now have a changed brief. */
export function rebriefNotice(root: string): string | undefined {
  const team = loadTeam(root);
  const sessions = loadSessions(root);
  const ids = team.seats.filter((s) => staleBrief(team, s, root, sessions[s.id])).map((s) => s.id);
  if (!ids.length) return undefined;
  const n = ids.length === 1 ? "1 seat's brief" : `${ids.length} seats' briefs`;
  return `${n} changed (${ids.join(", ")}): ${ids.length === 1 ? "it gets a re-brief when it next starts" : "they get a re-brief when they next start"}; otterpack status says more.`;
}

function staleBrief(team: Team, seat: Seat, root: string, entry: SessionEntry | undefined): string[] | undefined {
  if (!entry?.id || !entry.brief) return undefined;
  const changes = briefChanges(entry.brief, briefOf(team, seat, root));
  return changes.length ? changes : undefined;
}

function seatNode(doc: Document, id: string) {
  const node = seatsOf(doc).items.find((n) => isMap(n) && n.get("id") === id);
  if (!isMap(node)) throw new ConfigError(`no seat "${id}" in ${TEAM_FILE}`);
  return node;
}

/** Keeps the seat (persona, folder, conversation) but stops it and leaves it out of every start. */
export function disableSeat(root: string, id: string, opts: Opts = {}): string[] {
  const seat = seatOf(loadTeam(root), id);
  const lines: string[] = [];
  if (!seat.disabled) {
    for (const l of reportLines(editTeam(root, opts.home, (doc) => seatNode(doc, id).set("disabled", true)))) opts.onLine?.(l);
  }
  const again = seat.disabled ? "already disabled" : "disabled";
  lines.push(
    ...stopSessions(root, [id], opts, (_, o, where) =>
      o === "ours" ? `${id}: stopped and ${again}; its conversation is kept (otterpack enable ${id} brings it back)` :
      o === "other" ? `${id}: ${again} (${elsewhere(id, where)})` :
      `${id}: ${again}; it won't start on the next reload or otterpack up (otterpack enable ${id} brings it back)`,
    ).lines,
  );
  return lines;
}

export function enableSeat(root: string, id: string, opts: Opts = {}): string[] {
  const seat = seatOf(loadTeam(root), id);
  const line = seat.disabled
    ? `${id}: enabled. Start it: reload the VS Code window (its terminal opens), or otterpack up ${id}`
    : `${id}: already enabled`;
  if (seat.disabled) {
    for (const l of reportLines(editTeam(root, opts.home, (doc) => seatNode(doc, id).delete("disabled")))) opts.onLine?.(l);
  }
  opts.onLine?.(line);
  return [line];
}

function kitsOf(doc: Document) {
  const kits = doc.get("kits");
  if (kits === undefined) {
    doc.set("kits", doc.createNode([], { flow: true }));
    return doc.get("kits") as ReturnType<typeof seatsOf>;
  }
  if (!isSeq(kits)) throw new ConfigError("team.yaml: kits must be a list");
  return kits;
}

/** A library kit, or a project kit in .otterpack/local/kits/<kit>/. */
export function addKit(root: string, kit: string, opts: Opts = {}): SyncResult {
  if (loadTeam(root).kits.includes(kit)) throw new ConfigError(`kit "${kit}" is already in kits:`);
  return editTeam(root, opts.home, (doc) => kitsOf(doc).add(kit));
}

export function removeKit(root: string, kit: string, opts: Opts = {}): SyncResult {
  if (!loadTeam(root).kits.includes(kit)) throw new ConfigError(`kit "${kit}" is not in kits:`);
  return editTeam(root, opts.home, (doc) => {
    const kits = kitsOf(doc);
    kits.items = kits.items.filter((n) => (isScalar(n) ? n.value : n) !== kit);
  });
}
