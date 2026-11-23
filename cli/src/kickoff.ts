// The kickoff: the one message a seat gets on its first launch, the same for every harness.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import type { Seat, Team } from "./config.ts";
import { SEATS_DIR } from "./sync.ts";

export function marker(team: Team, seat: Seat): string {
  return `[seat:${team.name}/${seat.id}]`;
}

function sameContent(a: string, b: string): boolean {
  return existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
}

/** The files a seat is told to read, relative to the project root: persona, charter, addendum. */
export function briefFiles(team: Team, seat: Seat, root: string): string[] {
  if (seat.persona === "none") return [];
  const persona = `.otterpack/personas/${seat.persona}.md`;
  const addendum = `.otterpack/local/personas/${seat.persona}.md`;
  const files = [persona];
  if (team.charter) files.push(team.charter);
  // A project-only persona was copied from the local file: then that file is not an addendum.
  if (existsSync(join(root, addendum)) && !sameContent(join(root, addendum), join(root, persona))) files.push(addendum);
  return files;
}

function seatRel(root: string, seat: Seat): (p: string) => string {
  const cwd = join(root, seat.cwd);
  return (p: string) => relative(cwd, join(root, p)) || ".";
}

/** undefined for persona: none. Paths are relative to the seat's cwd. */
export function renderKickoff(team: Team, seat: Seat, root: string): string | undefined {
  if (seat.persona === "none") return undefined;
  const rel = seatRel(root, seat);
  return (
    `${marker(team, seat)} You are ${seat.label} on this team. Read, in order:\n` +
    briefFiles(team, seat, root).map((f, i) => `${i + 1}. ${rel(f)}`).join("\n") +
    `\nKeep your notes and state files in your seat folder: ${rel(`${SEATS_DIR}/${seat.id}`)}/`
  );
}

/** What a seat was told to read: its persona, and a hash of each file ("" if it was missing). */
export interface Brief {
  persona: string;
  files: Record<string, string>;
}

export function briefOf(team: Team, seat: Seat, root: string): Brief {
  const files: Record<string, string> = {};
  for (const f of briefFiles(team, seat, root)) {
    const p = join(root, f);
    files[f] = existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";
  }
  return { persona: seat.persona, files };
}

/** One line per difference, in the order the kickoff lists the files; [] when the seat is up to date. */
export function briefChanges(was: Brief, now: Brief): string[] {
  const out: string[] = [];
  if (was.persona !== now.persona) out.push(`persona ${was.persona} is now ${now.persona}`);
  for (const [f, h] of Object.entries(now.files)) {
    if (!(f in was.files)) out.push(`${f} added`);
    else if (was.files[f] !== h) out.push(`${f} changed`);
  }
  for (const f of Object.keys(was.files)) if (!(f in now.files)) out.push(`${f} no longer applies`);
  return out;
}

/** The message a resumed seat gets when its brief changed since it last read it. */
export function renderRebrief(team: Team, seat: Seat, root: string, changes: string[]): string {
  const head = `${marker(team, seat)} Your brief on this team changed since you last read it (${changes.join("; ")}). `;
  if (seat.persona === "none") return head + "You no longer have a persona file: drop the role it gave you, and work as the user asks.";
  const rel = seatRel(root, seat);
  return (
    head +
    `You are ${seat.label}. Read these again, in order; the current versions replace what you read before:\n` +
    briefFiles(team, seat, root).map((f, i) => `${i + 1}. ${rel(f)}`).join("\n") +
    `\nYour seat folder is still ${rel(`${SEATS_DIR}/${seat.id}`)}/`
  );
}
