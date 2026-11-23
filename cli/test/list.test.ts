// otterpack list: what the library offers, to choose a team, a persona or a kit from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listLibrary } from "../src/list.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { libraryRepo, commitLibrary, project, fakeHome, git, tmp } from "./helpers.ts";

const LIB = {
  "templates/web-team.yaml": "# web-team: a small web product\n# team. Edit freely.\nname: TEMPLATE\nlibrary: TEMPLATE\nkits: [core]\nseats:\n  - id: claude-pm\n    label: Product\n    icon: x\n    color: ansiBlue\n    persona: product-manager\n    harness: claude\n",
  "personas/product-manager.md": "# Product Manager\n\nYou own **why** and **for whom**: the problem worth solving. More text.\n",
  "personas/architect.md": "# Architect\n\nYou own the shape of the system. You don't write the code.\n",
  "kits/core/README.md": "Planning and handoff for every team.\n",
  "kits/core/skills/handoff/SKILL.md": "---\nname: handoff\n---\n",
  "kits/core/agents/planner.md": "planner\n",
  "kits/seo/skills/seo-audit/SKILL.md": "---\nname: seo-audit\n---\n",
};

test("outside a project: the library's latest commit, with templates, personas and kits described", () => {
  const lib = libraryRepo(LIB);
  const l = listLibrary({ library: lib, home: fakeHome() });
  assert.equal(l.source, lib);
  assert.equal(l.commit, git(lib, "rev-parse", "HEAD"));
  assert.deepEqual(l.templates, [{ id: "web-team", about: "a small web product team.", seats: ["claude-pm (product-manager)"] }]);
  assert.deepEqual(l.personas, [
    { id: "architect", about: "Architect: You own the shape of the system.", local: false, inUse: false },
    { id: "product-manager", about: "Product Manager: You own why and for whom: the problem worth solving.", local: false, inUse: false },
  ]);
  assert.deepEqual(l.kits, [
    { id: "core", about: "Planning and handoff for every team.", skills: 1, agents: 1, local: false, inUse: false },
    { id: "seo", about: "", skills: 1, agents: 0, local: false, inUse: false },
  ]);
});

test("inside a project: the pinned commit, what the team uses, and the project's local personas and kits", () => {
  const lib = libraryRepo(LIB);
  const pinned = git(lib, "rev-parse", "HEAD");
  commitLibrary(lib, { "personas/later.md": "# Later\n\nAdded after the pin.\n" });
  const root = project(
    `library: ${lib}\nkits: [core, stack]\nseats:\n  - id: claude-ar\n    label: Architect\n    icon: x\n    color: ansiBlue\n    persona: architect\n    harness: claude\n`,
    {
      ".otterpack/lock.json": JSON.stringify({ library: { source: lib, commit: pinned }, files: {} }),
      ".otterpack/local/personas/ops.md": "# Ops\n\nYou keep it running.\n",
      ".otterpack/local/kits/stack/skills/astro/SKILL.md": "---\nname: astro\n---\n",
    },
  );
  const l = listLibrary({ root, home: fakeHome() });
  assert.equal(l.commit, pinned);
  assert.deepEqual(l.personas.map((p) => [p.id, p.local, p.inUse]), [["architect", false, true], ["ops", true, false], ["product-manager", false, false]]);
  assert.deepEqual(l.kits.map((k) => [k.id, k.local, k.inUse]), [["core", false, true], ["seo", false, false], ["stack", true, true]]);
});

test("the list command prints each section, marks what the project uses, and says how to add it", () => {
  const lib = libraryRepo(LIB);
  const home = fakeHome();
  const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", INDEX, "list", "--library", lib], {
    cwd: tmp(), env: { ...process.env, HOME: home }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^library .* at [0-9a-f]{12}\n/);
  assert.match(r.stdout, /\ntemplates \(otterpack init --template <t>\):\n  web-team +a small web product team\.\n +seats: claude-pm \(product-manager\)\n/);
  assert.match(r.stdout, /\npersonas \(otterpack add <seat> --persona <p>\):\n  architect +Architect: You own the shape of the system\.\n/);
  assert.match(r.stdout, /\nkits \(otterpack kit add <kit>\):\n  core +1 skill, 1 agent +Planning and handoff for every team\.\n  seo +1 skill\n/);
  const bad = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", INDEX, "list", "extra"], { cwd: tmp(), encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /list takes no arguments/);
});
