import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { sync } from "../src/sync.ts";
import { update } from "../src/update.ts";
import { libraryRepo, commitLibrary, project, read, git, fakeHome } from "./helpers.ts";

function setup() {
  const lib = libraryRepo({ "personas/product-owner.md": "v1\n", "kits/core/agents/a.md": "a\n", "kits/core/agents/gone.md": "g\n" });
  const root = project(`library: ${lib}
kits: [core]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
`);
  const home = fakeHome();
  sync(root, { home });
  return { lib, root, home };
}

test("update moves the pin to the library's latest commit and syncs", () => {
  const { lib, root, home } = setup();
  const before = git(lib, "rev-parse", "HEAD");
  commitLibrary(lib, { "personas/product-owner.md": "v2\n" });
  git(lib, "rm", "-q", "library/kits/core/agents/gone.md");
  git(lib, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "-m", "drop gone");
  const r = update(root, { home });
  assert.equal(r.from, before);
  assert.equal(r.to, git(lib, "rev-parse", "HEAD"));
  assert.equal(read(root, ".otterpack/personas/product-owner.md"), "v2\n");
  assert.deepEqual(r.written, [".otterpack/personas/product-owner.md"]);
  assert.deepEqual(r.removed, [".claude/agents/gone.md"]);
  assert.deepEqual(r.log.map((l) => l.replace(/^\w+ /, "")), ["drop gone", "change"]);
  assert.equal(JSON.parse(read(root, ".otterpack/lock.json")).library.commit, r.to);
});

test("update with nothing new changes nothing", () => {
  const { root, home } = setup();
  const r = update(root, { home });
  assert.equal(r.from, r.to);
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.log, []);
});

test("update to a library whose history doesn't contain the old pin still works (no log)", () => {
  const { root, home } = setup();
  const other = libraryRepo({ "personas/product-owner.md": "other\n", "kits/core/agents/a.md": "a\n" });
  writeFileSync(`${root}/.otterpack/team.yaml`, read(root, ".otterpack/team.yaml").replace(/^library: .*$/m, `library: ${other}`));
  const r = update(root, { home });
  assert.equal(r.to, git(other, "rev-parse", "HEAD"));
  assert.deepEqual(r.log, ["(the old pin is not in this library's history)"]);
  assert.equal(read(root, ".otterpack/personas/product-owner.md"), "other\n");
});

test("update stops on a conflict and leaves the old pin", () => {
  const { lib, root, home } = setup();
  const before = JSON.parse(read(root, ".otterpack/lock.json")).library.commit;
  commitLibrary(lib, { "kits/core/agents/new.md": "n\n" });
  writeFileSync(`${root}/.claude/agents/new.md`, "mine\n");
  assert.throws(() => update(root, { home }), /new\.md: exists and was not generated/);
  assert.equal(JSON.parse(read(root, ".otterpack/lock.json")).library.commit, before);
});
