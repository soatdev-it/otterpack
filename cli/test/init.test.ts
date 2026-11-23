import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { loadTeam } from "../src/config.ts";
import { libraryRepo, fakeHome, tmp, read, exists, writeFiles } from "./helpers.ts";

const TEMPLATE = `# A two-seat test shape.
name: TEMPLATE
library: TEMPLATE
kits: [core]
seats:
  - id: claude-po
    label: PO
    icon: target
    color: ansiBlue
    persona: product-owner
    harness: claude
`;

function setup() {
  const lib = libraryRepo({ "templates/mini.yaml": TEMPLATE, "personas/product-owner.md": "po\n", "kits/core/agents/a.md": "a\n" });
  const dir = join(tmp(), "my-site");
  mkdirSync(dir);
  return { lib, dir, home: fakeHome() };
}

test("init writes .otterpack/team.yaml from the template, with this project's name and library", () => {
  const { lib, dir, home } = setup();
  init(dir, { template: "mini", library: lib, home });
  const team = loadTeam(dir);
  assert.equal(team.name, "my-site");
  assert.equal(team.library, lib);
  assert.deepEqual(team.seats.map((s) => s.id), ["claude-po"]);
  assert.match(read(dir, ".otterpack/team.yaml"), /^# A two-seat test shape\./);
});

test("init refuses to overwrite an existing team.yaml", () => {
  const { lib, dir, home } = setup();
  writeFiles(dir, { ".otterpack/team.yaml": "mine\n" });
  assert.throws(() => init(dir, { template: "mini", library: lib, home }), /already exists/);
  assert.equal(read(dir, ".otterpack/team.yaml"), "mine\n");
});

test("an unknown template lists the ones that exist", () => {
  const { lib, dir, home } = setup();
  assert.throws(() => init(dir, { template: "huge", library: lib, home }), /template "huge" not found.*mini/);
  assert.ok(!exists(dir, ".otterpack/team.yaml"));
});

test("init refuses when a lock.json from an earlier team is still there", () => {
  const { lib, dir, home } = setup();
  writeFiles(dir, { ".otterpack/lock.json": "{}\n" });
  assert.throws(() => init(dir, { template: "mini", library: lib, home }), /lock\.json.*remove \.otterpack/);
});

test("a template name can't leave the library's templates folder", () => {
  const { lib, dir, home } = setup();
  assert.throws(() => init(dir, { template: "../../etc/x", library: lib, home }), /template "\.\.\/\.\.\/etc\/x"/);
});

test("a template naming a kit or persona the library lacks fails, and writes nothing", () => {
  const lib = libraryRepo({ "templates/bad.yaml": TEMPLATE.replace("kits: [core]", "kits: [ghost]") });
  const dir = tmp();
  assert.throws(() => init(dir, { template: "bad", library: lib, home: fakeHome() }), /kit "ghost"/);
  assert.ok(!exists(dir, ".otterpack/team.yaml"));
});

test("a relative library path is kept as written and works from the project root", () => {
  const { lib, home } = setup();
  const parent = join(lib, "..");
  const dir = join(parent, `proj-rel-${process.pid}-${Date.now()}`);
  mkdirSync(dir);
  const rel = `../${lib.split("/").at(-1)}`;
  init(dir, { template: "mini", library: rel, home });
  assert.equal(loadTeam(dir).library, rel);
  rmSync(dir, { recursive: true, force: true });
});

test("the init command syncs right away and says how to open the seats", () => {
  const { lib, dir, home } = setup();
  const index = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", index, "init", "--template", "mini", "--library", lib], {
    cwd: dir, env: { ...process.env, HOME: home }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(exists(dir, ".otterpack/lock.json"));
  assert.equal(read(dir, ".otterpack/personas/product-owner.md"), "po\n");
  assert.ok(exists(dir, ".vscode/tasks.json"));
  assert.ok(exists(dir, ".otterpack/seats/claude-po"));
  assert.match(r.stdout, /Reload the VS Code window/);
});

test("the default library is the HTTPS address (works through gh or VS Code's git credentials)", async () => {
  const { DEFAULT_LIBRARY } = await import("../src/init.ts");
  assert.equal(DEFAULT_LIBRARY, "https://github.com/soatdev-it/otterpack.git");
});

test("--version prints the package version (the install script compares it with the tag)", () => {
  const index = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", index, "--version"], { encoding: "utf8" });
  const pkg = JSON.parse(read(fileURLToPath(new URL("../..", import.meta.url)), "package.json"));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("init --replace: an existing project's hand-made copies don't stop the first sync", () => {
  const { lib, dir, home } = setup();
  writeFiles(dir, { ".claude/agents/a.md": "hand-made\n" });
  const index = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const run = (...a: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", index, ...a], { cwd: dir, env: { ...process.env, HOME: home }, encoding: "utf8" });
  const r = run("init", "--template", "mini", "--library", lib, "--replace");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, ".claude/agents/a.md"), "a\n");
  assert.match(r.stdout, /moved 1 hand-made path.* to \.otterpack\/replaced\//);
});

test("init keeps a long kits: list on one line (easy to edit by hand)", () => {
  const kits = ["first-long-kit-name", "second-long-kit-name", "third-long-kit-name", "fourth-long-kit-name"];
  const files: Record<string, string> = {
    "templates/wide.yaml": TEMPLATE.replace("kits: [core]", `kits: [${kits.join(", ")}]`),
    "personas/product-owner.md": "po\n",
  };
  for (const k of kits) files[`kits/${k}/agents/${k}.md`] = "a\n";
  const lib = libraryRepo(files);
  const dir = join(tmp(), "wide");
  mkdirSync(dir);
  init(dir, { template: "wide", library: lib, home: fakeHome() });
  assert.match(read(dir, ".otterpack/team.yaml"), new RegExp(`^kits: \\[${kits.join(", ")}\\]$`, "m"));
});
