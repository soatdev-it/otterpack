// scripts/install-otterpack.sh: what it does with the version already installed. A fake
// `otterpack` on PATH reports the version; the repository is unreachable, so a test that
// expects no install fails loudly if the script tries one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "./helpers.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/install-otterpack.sh", import.meta.url));

function run(installed: string | undefined, tag: string) {
  const bin = tmp("otterpack-bin-");
  if (installed !== undefined) {
    writeFileSync(join(bin, "otterpack"), `#!/bin/sh\necho ${installed}\n`);
    chmodSync(join(bin, "otterpack"), 0o755);
  }
  const r = spawnSync("sh", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, OTTERPACK_TAG: tag, OTTERPACK_REPO: join(tmp(), "no-such-repo"), GIT_TERMINAL_PROMPT: "0" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("the pinned version already installed: nothing to do", () => {
  const r = run("0.6.2", "v0.6.2");
  assert.equal(r.code, 0);
  assert.match(r.out, /v0\.6\.2 already installed/);
});

test("a newer version installed is kept, never replaced by an older TAG (a window reload must not downgrade)", () => {
  const r = run("0.6.2", "v0.6.0");
  assert.equal(r.code, 0);
  assert.match(r.out, /v0\.6\.2 is installed, newer than TAG v0\.6\.0: kept/);
  assert.doesNotMatch(r.out, /can't read/, "it must not try to install");
});

test("an older version installed is upgraded to TAG (here: the repository can't be read, and it says so)", () => {
  for (const installed of ["0.6.0", "0.10.0"]) {
    const r = run(installed, installed === "0.6.0" ? "v0.6.2" : "v0.11.0");
    assert.equal(r.code, 0, "it never fails the container build");
    assert.match(r.out, /can't read/, `${installed}: it tried to install`);
  }
});

test("numeric order, not text order: 0.10.0 is newer than 0.9.0", () => {
  const r = run("0.10.0", "v0.9.0");
  assert.match(r.out, /v0\.10\.0 is installed, newer than TAG v0\.9\.0: kept/);
});
