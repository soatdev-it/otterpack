// team.yaml: the project's seats and kits. Strict on purpose: an unknown key is an error.
import { readFileSync, existsSync } from "node:fs";
import { basename, join, normalize, isAbsolute, dirname, resolve } from "node:path";
import { parse } from "yaml";

export type Harness = "claude" | "codex";

export interface Seat {
  id: string;
  label: string;
  icon: string;
  color: string;       // without the "terminal." prefix
  persona: string;     // "none" for no persona and no kickoff
  harness: Harness;
  cwd: string;         // relative to the project root
  args: string[];
  launcher?: string;   // project script, relative to the project root
  disabled: boolean;   // kept in the team, but not started and given no VS Code task
}

export interface Team {
  name: string;
  library: string;
  charter?: string;
  kits: string[];
  seats: Seat[];
}

export const TEAM_FILE = ".otterpack/team.yaml";

const TOP_KEYS = ["name", "library", "charter", "kits", "seats"];
const SEAT_KEYS = ["id", "label", "icon", "color", "persona", "harness", "cwd", "args", "launcher", "disabled"];
const SEAT_ID = /^[A-Za-z0-9_-]+$/;  // tmux treats "." and ":" specially
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/; // kit and persona ids: one path segment

function segment(v: string, what: string): string {
  if (!NAME.test(v) || v.includes("..")) fail(`${what} "${v}" may only use letters, digits, ., - and _`);
  return v;
}

export class ConfigError extends Error {}

function fail(msg: string): never {
  throw new ConfigError(`team.yaml: ${msg}`);
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`${where}unknown key "${k}"`);
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(`${what} is required`);
  return v;
}

function strList(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail(`${what} must be a list of strings`);
  return v as string[];
}

function inside(rel: string, what: string): string {
  const n = normalize(rel);
  if (isAbsolute(n) || n === ".." || n.startsWith("../")) fail(`${what} must stay inside the project`);
  return n;
}

export function parseTeam(text: string, root: string): Team {
  const doc = parse(text) ?? {};
  if (typeof doc !== "object" || Array.isArray(doc)) fail("expected a mapping at the top");
  checkKeys(doc, TOP_KEYS, "");
  const seatsRaw = doc.seats;
  if (!Array.isArray(seatsRaw) || seatsRaw.length === 0) fail("seats must be a non-empty list");
  const seen = new Set<string>();
  const labels = new Set<string>();
  const seats: Seat[] = seatsRaw.map((raw: any, i: number) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`seat ${i + 1} must be a mapping`);
    const id = str(raw.id, `seat ${i + 1}: id`);
    if (!SEAT_ID.test(id)) fail(`seat id "${id}" may only use letters, digits, - and _ (it is the tmux session name)`);
    checkKeys(raw, SEAT_KEYS, `seat ${id}: `);
    if (seen.has(id)) fail(`duplicate seat id "${id}"`);
    seen.add(id);
    const harness = raw.harness;
    if (harness !== "claude" && harness !== "codex") fail(`seat ${id}: harness must be claude or codex`);
    const seat: Seat = {
      id,
      label: str(raw.label, `seat ${id}: label`),
      icon: str(raw.icon, `seat ${id}: icon`),
      color: str(raw.color, `seat ${id}: color`).replace(/^terminal\./, ""),
      persona: segment(str(raw.persona, `seat ${id}: persona`), `seat ${id}: persona`),
      harness,
      cwd: raw.cwd === undefined ? "." : inside(str(raw.cwd, `seat ${id}: cwd`), `seat ${id}: cwd`),
      args: strList(raw.args, `seat ${id}: args`),
      disabled: raw.disabled ?? false,
    };
    if (typeof seat.disabled !== "boolean") fail(`seat ${id}: disabled must be true or false`);
    if (labels.has(seat.label)) fail(`duplicate seat label "${seat.label}" (VS Code tasks are matched by label)`);
    labels.add(seat.label);
    if (raw.launcher !== undefined) seat.launcher = inside(str(raw.launcher, `seat ${id}: launcher`), `seat ${id}: launcher`);
    return seat;
  });
  const team: Team = {
    name: doc.name === undefined ? basename(root) : str(doc.name, "name"),
    library: str(doc.library, "library"),
    kits: strList(doc.kits, "kits").map((k) => segment(k, "kit")),
    seats,
  };
  if (doc.charter !== undefined) team.charter = inside(str(doc.charter, "charter"), "charter");
  return team;
}

/** The project root: the nearest folder upwards holding .otterpack/team.yaml. */
export function findRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, TEAM_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new ConfigError(`no ${TEAM_FILE} found in ${from} or any parent folder (run otterpack init)`);
    dir = up;
  }
}

export function loadTeam(root: string): Team {
  return parseTeam(readFileSync(join(root, TEAM_FILE), "utf8"), root);
}

export function seatOf(team: Team, id: string): Seat {
  const seat = team.seats.find((s) => s.id === id);
  if (!seat) throw new ConfigError(`no seat "${id}" in ${TEAM_FILE} (seats: ${team.seats.map((s) => s.id).join(", ")})`);
  return seat;
}
