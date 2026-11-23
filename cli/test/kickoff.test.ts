import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeam } from "../src/config.ts";
import { renderKickoff, marker } from "../src/kickoff.ts";
import { project, writeFiles } from "./helpers.ts";

const yaml = (extra = "", charter = "charter: docs/CHARTER.md\n") => `name: acme
library: ../lib
${charter}kits: []
seats:
  - id: codex-re
    label: DevSecOps
    icon: shield
    color: ansiBrightRed
    persona: devsecops
    harness: codex
${extra}`;

test("marker carries the project name and the seat id", () => {
  const team = parseTeam(yaml(), "/w");
  assert.equal(marker(team, team.seats[0]), "[seat:acme/codex-re]");
});

test("kickoff lists persona, charter and addendum, relative to the seat cwd", () => {
  const root = project(yaml(), { ".otterpack/local/personas/devsecops.md": "addendum\n", ".otterpack/personas/devsecops.md": "p\n" });
  const team = parseTeam(yaml(), root);
  assert.equal(
    renderKickoff(team, team.seats[0], root),
    "[seat:acme/codex-re] You are DevSecOps on this team. Read, in order:\n" +
      "1. .otterpack/personas/devsecops.md\n" +
      "2. docs/CHARTER.md\n" +
      "3. .otterpack/local/personas/devsecops.md\n" +
      "Keep your notes and state files in your seat folder: .otterpack/seats/codex-re/",
  );
});

test("no charter line without a charter, no addendum line without the file", () => {
  const y = yaml("", "");
  const root = project(y);
  const team = parseTeam(y, root);
  assert.equal(
    renderKickoff(team, team.seats[0], root),
    "[seat:acme/codex-re] You are DevSecOps on this team. Read, in order:\n1. .otterpack/personas/devsecops.md\n" +
      "Keep your notes and state files in your seat folder: .otterpack/seats/codex-re/",
  );
});

test("a project-only persona has no addendum line (the local file is the persona)", () => {
  // sync copied the local file as the persona, so the two are identical
  const root = project(yaml(), {
    ".otterpack/local/personas/devsecops.md": "whole persona\n",
    ".otterpack/personas/devsecops.md": "whole persona\n",
  });
  const team = parseTeam(yaml(), root);
  assert.doesNotMatch(renderKickoff(team, team.seats[0], root)!, /3\./);
});

test("paths are relative to a subfolder cwd", () => {
  const y = yaml("    cwd: docs/team/drafts\n");
  const root = project(y);
  const team = parseTeam(y, root);
  assert.match(renderKickoff(team, team.seats[0], root)!, /1\. \.\.\/\.\.\/\.\.\/\.otterpack\/personas\/devsecops\.md/);
  assert.match(renderKickoff(team, team.seats[0], root)!, /seat folder: \.\.\/\.\.\/\.\.\/\.otterpack\/seats\/codex-re\/$/);
});

test("persona: none gets no kickoff", () => {
  const y = yaml().replace("persona: devsecops", "persona: none");
  const team = parseTeam(y, "/w");
  assert.equal(renderKickoff(team, team.seats[0], "/w"), undefined);
});

// The brief: what a seat was told to read, so a later change can be told to it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { briefOf, briefChanges, renderRebrief } from "../src/kickoff.ts";

function briefed() {
  const root = project(yaml(), { ".otterpack/personas/devsecops.md": "p1\n", "docs/CHARTER.md": "c1\n" });
  return { root, team: parseTeam(yaml(), root) };
}

test("a brief records the persona and a hash of each file the kickoff lists", () => {
  const { root, team } = briefed();
  const b = briefOf(team, team.seats[0], root);
  assert.equal(b.persona, "devsecops");
  assert.deepEqual(Object.keys(b.files), [".otterpack/personas/devsecops.md", "docs/CHARTER.md"]);
  assert.match(b.files[".otterpack/personas/devsecops.md"], /^[0-9a-f]{64}$/);
  assert.deepEqual(briefChanges(b, briefOf(team, team.seats[0], root)), []);
});

test("brief changes: an edited persona or charter, an addendum added, another persona", () => {
  const { root, team } = briefed();
  const seat = team.seats[0];
  const before = briefOf(team, seat, root);
  writeFileSync(join(root, ".otterpack/personas/devsecops.md"), "p2\n");
  writeFileSync(join(root, "docs/CHARTER.md"), "c2\n");
  writeFiles(root, { ".otterpack/local/personas/devsecops.md": "add\n" });
  assert.deepEqual(briefChanges(before, briefOf(team, seat, root)), [
    ".otterpack/personas/devsecops.md changed",
    "docs/CHARTER.md changed",
    ".otterpack/local/personas/devsecops.md added",
  ]);
  writeFiles(root, { ".otterpack/personas/architect.md": "a\n" });
  const other = { ...seat, persona: "architect" };
  assert.deepEqual(briefChanges(before, briefOf(team, other, root))[0], "persona devsecops is now architect");
});

test("the re-brief names what changed and lists the files to re-read, relative to the seat cwd", () => {
  const { root, team } = briefed();
  const seat = team.seats[0];
  assert.equal(
    renderRebrief(team, seat, root, [".otterpack/personas/devsecops.md changed"]),
    "[seat:acme/codex-re] Your brief on this team changed since you last read it (.otterpack/personas/devsecops.md changed). " +
      "You are DevSecOps. Read these again, in order; the current versions replace what you read before:\n" +
      "1. .otterpack/personas/devsecops.md\n" +
      "2. docs/CHARTER.md\n" +
      "Your seat folder is still .otterpack/seats/codex-re/",
  );
});

test("the re-brief of a seat whose persona was taken away says so", () => {
  const { root, team } = briefed();
  const seat = { ...team.seats[0], persona: "none" };
  assert.equal(
    renderRebrief(team, seat, root, ["persona devsecops is now none"]),
    "[seat:acme/codex-re] Your brief on this team changed since you last read it (persona devsecops is now none). " +
      "You no longer have a persona file: drop the role it gave you, and work as the user asks.",
  );
});
