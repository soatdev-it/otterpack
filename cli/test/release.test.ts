import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const text = (f: string) => readFileSync(join(REPO, f), "utf8");
const version = JSON.parse(text("package.json")).version as string;

test("the install script, README and changelog name the package version's tag", () => {
  assert.match(text("scripts/install-otterpack.sh"), new RegExp(`^TAG=\\$\\{OTTERPACK_TAG:-v${version}\\}$`, "m"));
  const readmeTags = [...text("README.md").matchAll(/(?:--branch |refs\/tags\/)(v[0-9][^ /"]*?)(?:\.tar\.gz)?[ "\n]/g)].map((m) => m[1]);
  assert.ok(readmeTags.length >= 2, "README names the tag in both install paths");
  assert.deepEqual([...new Set(readmeTags)], [`v${version}`]);
  assert.match(text("CHANGELOG.md"), new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
});

// otterpack's own skills; every other skill was copied and carries its upstream license.
const OWN_SKILLS = new Set(["web-interface-review"]);

test("every third-party skill carries its LICENSE.txt and is listed in THIRD_PARTY_NOTICES.md", () => {
  const notices = text("THIRD_PARTY_NOTICES.md");
  const kits = join(REPO, "library/kits");
  for (const kit of readdirSync(kits)) {
    const dir = join(kits, kit, "skills");
    if (!existsSync(dir)) continue;
    for (const skill of readdirSync(dir)) {
      if (OWN_SKILLS.has(skill)) continue;
      assert.ok(existsSync(join(dir, skill, "LICENSE.txt")), `${kit}/${skill} has no LICENSE.txt`);
      assert.ok(new RegExp(`\\b${skill}\\b`).test(notices), `${kit}/${skill} is not in THIRD_PARTY_NOTICES.md`);
    }
  }
});

test("every third-party agent is listed in THIRD_PARTY_NOTICES.md", () => {
  const notices = text("THIRD_PARTY_NOTICES.md");
  const kits = join(REPO, "library/kits");
  for (const kit of readdirSync(kits)) {
    const dir = join(kits, kit, "agents");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) assert.ok(notices.includes(f.replace(/\.md$/, "")), `${kit}/${f} is not in THIRD_PARTY_NOTICES.md`);
  }
});
