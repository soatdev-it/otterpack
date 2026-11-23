import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "../src/lock.ts";
import { tmp } from "./helpers.ts";

const SRC = fileURLToPath(new URL("../src/lock.ts", import.meta.url));

test("a lock file left behind with a live pid in it doesn't block (the kernel holds the lock, not the file)", async () => {
  const path = join(tmp(), "up.lock");
  writeFileSync(path, "1"); // pid 1 is always alive
  const t0 = Date.now();
  const release = await acquire(path, 5_000);
  release();
  assert.ok(Date.now() - t0 < 2_000);
});

test("a holder killed with SIGKILL releases the lock at once", async () => {
  const path = join(tmp(), "up.lock");
  const holder = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
    `import { acquire } from ${JSON.stringify(SRC)}; await acquire(${JSON.stringify(path)}); console.log("held"); setInterval(() => {}, 1e6);`], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((res) => holder.stdout.on("data", (d) => String(d).includes("held") && res()));
  holder.kill("SIGKILL");
  const t0 = Date.now();
  const release = await acquire(path, 5_000);
  release();
  assert.ok(Date.now() - t0 < 2_000, `took ${Date.now() - t0} ms`);
});

test("only one holder at a time, across many concurrent waiters", async () => {
  const path = join(tmp(), "up.lock");
  let inside = 0;
  let max = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      const release = await acquire(path, 20_000);
      inside++;
      max = Math.max(max, inside);
      await new Promise((r) => setTimeout(r, 20));
      inside--;
      release();
    }),
  );
  assert.equal(max, 1);
});

test("times out with a clear error that names the holder", async () => {
  const path = join(tmp(), "up.lock");
  const release = await acquire(path, 5_000, "otterpack up claude-po in /p");
  await assert.rejects(
    acquire(path, 1_000),
    new RegExp(`timed out after 1s waiting for the lock .*held by pid ${process.pid} \\(otterpack up claude-po in /p\\), for \\d+s now\\. If that process is stuck, stop it \\(kill ${process.pid}\\)`),
  );
  release();
});
