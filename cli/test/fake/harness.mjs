#!/usr/bin/env node
// Fake `claude` / `codex` for tests. Logs its argv to $FAKE_LOG (one JSON line per run),
// writes the session file the real CLI would, then stays alive until killed unless
// FAKE_EXIT is set. Never talks to a model.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const home = process.env.HOME;
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, cwd: process.cwd() }) + "\n");

// The prompt is the positional argument: anything not a flag or a flag's value.
const WITH_VALUE = new Set(["--name", "-n", "--session-id", "--resume", "-r", "--model", "--settings", "--permission-mode", "-c", "--config", "--agents"]);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (WITH_VALUE.has(args[i])) i++;
  else if (!args[i].startsWith("-") && !(name === "codex" && i === 0 && args[i] === "resume")) positional.push(args[i]);
}
const prompt = name === "codex" && args[0] === "resume" ? undefined : positional.at(-1);

if (name === "claude") {
  const i = args.indexOf("--session-id");
  if (i >= 0 && prompt !== undefined) {
    const last = prompt;
    const slug = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
    mkdirSync(join(home, ".claude/projects", slug), { recursive: true });
    writeFileSync(join(home, ".claude/projects", slug, `${args[i + 1]}.jsonl`), JSON.stringify({ prompt: last }) + "\n");
  }
} else if (name === "codex" && args[0] !== "resume") {
  const id = randomUUID();
  const day = new Date().toISOString().slice(0, 10).split("-");
  const dir = join(home, ".codex/sessions", ...day);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.jsonl`);
  writeFileSync(file, JSON.stringify({ timestamp: "", type: "session_meta", payload: { id, cwd: process.cwd(), originator: "codex-tui" } }) + "\n");
  const delay = Number(process.env.FAKE_CODEX_DELAY_MS ?? 300);
  if (prompt !== undefined) setTimeout(() => appendFileSync(file, JSON.stringify({ type: "user", text: prompt }) + "\n"), delay);
}

if (process.env.FAKE_EXIT !== undefined) setTimeout(() => process.exit(Number(process.env.FAKE_EXIT)), 600);
else setInterval(() => {}, 1 << 30);
