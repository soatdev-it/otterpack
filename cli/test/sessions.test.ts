import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadSessions, setSession } from "../src/sessions.ts";
import { project, read } from "./helpers.ts";

test("sessions live in .otterpack/state/sessions/<seat>.json", () => {
  const root = project("x");
  assert.deepEqual(loadSessions(root), {});
  setSession(root, "claude-po", { harness: "claude", id: "U1", confirmed: false });
  setSession(root, "codex-re", { harness: "codex", id: "C1", confirmed: true });
  assert.deepEqual(JSON.parse(read(root, ".otterpack/state/sessions/claude-po.json")), { harness: "claude", id: "U1", confirmed: false });
  assert.deepEqual(loadSessions(root), {
    "claude-po": { harness: "claude", id: "U1", confirmed: false },
    "codex-re": { harness: "codex", id: "C1", confirmed: true },
  });
});

test("concurrent writers (one launch per seat) don't lose each other's entries", async () => {
  const root = project("x");
  const src = fileURLToPath(new URL("../src/sessions.ts", import.meta.url));
  const script = `import { setSession } from ${JSON.stringify(src)};
    for (let i = 0; i < 20; i++) setSession(${JSON.stringify(root)}, process.argv[1] + "-" + i, { harness: "claude", id: "x", confirmed: true });`;
  const run = (name: string) =>
    new Promise<void>((res, rej) => {
      const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script, name], { stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`))));
    });
  await Promise.all([run("a"), run("b"), run("c")]);
  assert.equal(Object.keys(loadSessions(root)).length, 60);
});
