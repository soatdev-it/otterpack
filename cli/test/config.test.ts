import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeam } from "../src/config.ts";

const base = `
library: ../lib
kits: [a]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
`;

test("parses a team and fills defaults", () => {
  const team = parseTeam(base, "/work/myproj");
  assert.equal(team.name, "myproj");
  assert.deepEqual(team.kits, ["a"]);
  const s = team.seats[0];
  assert.equal(s.id, "claude-po");
  assert.equal(s.cwd, ".");
  assert.deepEqual(s.args, []);
  assert.equal(s.launcher, undefined);
  assert.equal(team.charter, undefined);
});

test("name from team.yaml wins over the folder name", () => {
  assert.equal(parseTeam("name: acme\n" + base, "/workspace").name, "acme");
});

test("rejects duplicate seat ids", () => {
  const dup = base + `  - id: claude-po
    label: PO2
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
`;
  assert.throws(() => parseTeam(dup, "/p"), /duplicate seat id "claude-po"/);
});

test("rejects unknown keys, so typos don't pass silently", () => {
  assert.throws(() => parseTeam(base.replace("persona:", "persnoa:"), "/p"), /unknown key "persnoa"/);
  assert.throws(() => parseTeam("kitz: []\n" + base, "/p"), /unknown key "kitz"/);
});

test("rejects per-seat kits (kits are installed per project)", () => {
  assert.throws(() => parseTeam(base + "    kits: [b]\n", "/p"), /unknown key "kits"/);
});

test("rejects an unknown harness and a missing field", () => {
  assert.throws(() => parseTeam(base.replace("harness: claude", "harness: gemini"), "/p"), /harness must be claude or codex/);
  assert.throws(() => parseTeam(base.replace("    icon: target\n", ""), "/p"), /seat claude-po: icon is required/);
});

test("rejects seat ids that are not safe tmux session names", () => {
  assert.throws(() => parseTeam(base.replace("id: claude-po", "id: claude po"), "/p"), /seat id/);
  assert.throws(() => parseTeam(base.replace("id: claude-po", "id: a.b"), "/p"), /seat id/);
});

test("rejects a cwd outside the project", () => {
  assert.throws(() => parseTeam(base + "    cwd: ../elsewhere\n", "/p"), /cwd must stay inside the project/);
});

test("args must be a list of strings", () => {
  assert.throws(() => parseTeam(base + "    args: --model opus\n", "/p"), /args must be a list of strings/);
  const t = parseTeam(base + "    args: [--model, opus]\n", "/p");
  assert.deepEqual(t.seats[0].args, ["--model", "opus"]);
});

test("kit and persona ids are single path segments", () => {
  assert.throws(() => parseTeam(base.replace("persona: product-owner", "persona: ../../x"), "/p"), /persona "\.\.\/\.\.\/x"/);
  assert.throws(() => parseTeam(base.replace("kits: [a]", "kits: [../a]"), "/p"), /kit "\.\.\/a"/);
});

test("seat labels are unique (the open-all task refers to seats by label)", () => {
  const dup = base + `  - id: claude-po2
    label: PO
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
`;
  assert.throws(() => parseTeam(dup, "/p"), /duplicate seat label "PO"/);
});

test("disabled: true marks a seat as off; it must be a boolean", () => {
  const y = (v: string) => `library: x
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: none
    harness: claude
    disabled: ${v}
`;
  assert.equal(parseTeam(y("true"), "/w").seats[0].disabled, true);
  assert.equal(parseTeam(y("false"), "/w").seats[0].disabled, false);
  assert.throws(() => parseTeam(y("yes please"), "/w"), /disabled must be true or false/);
});
