// The library shipped in this repo: templates must resolve, content must be generic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTeam } from "../src/config.ts";
import { plan } from "../src/sync.ts";
import { tmp } from "./helpers.ts";

const LIB = fileURLToPath(new URL("../../library", import.meta.url));
const templates = () => readdirSync(join(LIB, "templates")).filter((f) => f.endsWith(".yaml"));

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

test("the library has personas, kits and at least the web-team template", () => {
  assert.ok(existsSync(join(LIB, "templates/web-team.yaml")));
  assert.ok(readdirSync(join(LIB, "personas")).length > 0);
  assert.ok(readdirSync(join(LIB, "kits")).length > 0);
});

test("every template parses and only names kits and personas the library has", () => {
  for (const t of templates()) {
    const team = parseTeam(readFileSync(join(LIB, "templates", t), "utf8"), "/w");
    for (const k of team.kits) assert.ok(existsSync(join(LIB, "kits", k)), `${t}: kit ${k}`);
    for (const s of team.seats) {
      if (s.persona !== "none") assert.ok(existsSync(join(LIB, "personas", `${s.persona}.md`)), `${t}: persona ${s.persona}`);
    }
  }
});

test("every kit ships skills (with SKILL.md) or agents, nothing else at its top", () => {
  for (const k of readdirSync(join(LIB, "kits"))) {
    const top = readdirSync(join(LIB, "kits", k)).filter((e) => e !== "README.md");
    assert.ok(top.length > 0 && top.every((e) => e === "skills" || e === "agents"), `kit ${k}: ${top}`);
    if (top.includes("skills")) {
      for (const s of readdirSync(join(LIB, "kits", k, "skills"))) {
        assert.ok(existsSync(join(LIB, "kits", k, "skills", s, "SKILL.md")), `kit ${k}: skill ${s} has no SKILL.md`);
      }
    }
  }
});

test("web-team has six seats, each with its library persona", () => {
  const team = parseTeam(readFileSync(join(LIB, "templates/web-team.yaml"), "utf8"), "/w");
  assert.deepEqual(team.seats.map((s) => [s.id, s.persona]), [
    ["claude-pm", "product-manager"],
    ["claude-po", "po-marketing"],
    ["claude-ar", "architect"],
    ["claude-copy", "copywriter"],
    ["claude-seo", "seo-expert"],
    ["claude-web", "web-developer"],
  ]);
});

test("web-team keeps the context small: <= 15 agents, <= 45 skills", () => {
  const team = parseTeam(readFileSync(join(LIB, "templates/web-team.yaml"), "utf8"), "/w");
  const out = plan(tmp(), team, LIB);
  const agents = [...out.keys()].filter((p) => p.startsWith(".claude/agents/"));
  const skills = new Set([...out.keys()].filter((p) => p.startsWith(".agents/skills/")).map((p) => p.split("/")[2]));
  assert.ok(agents.length <= 15, `${agents.length} agents`);
  assert.ok(skills.size <= 45, `${skills.size} skills`);
});

test("dev-team: architect, developer, code reviewer and QA, with library personas and within the context targets", () => {
  const team = parseTeam(readFileSync(join(LIB, "templates/dev-team.yaml"), "utf8"), "/w");
  assert.deepEqual(team.seats.map((s) => [s.id, s.persona, s.harness]), [
    ["claude-ar", "architect", "claude"],
    ["claude-dev", "developer", "claude"],
    ["claude-rev", "code-reviewer", "claude"],
    ["claude-qa", "qa", "claude"],
  ]);
  const out = plan(tmp(), team, LIB); // throws if a persona or kit is missing
  assert.ok([...out.keys()].filter((p) => p.startsWith(".claude/agents/")).length <= 15);
  assert.ok(new Set([...out.keys()].filter((p) => p.startsWith(".agents/skills/")).map((p) => p.split("/")[2])).size <= 45);
  assert.ok(!team.kits.includes("seo") && !team.kits.includes("marketing"), "no web marketing kits");
});

test("every persona has a title, an opening line that says what the seat owns, and Never and status sections", () => {
  for (const f of readdirSync(join(LIB, "personas"))) {
    const text = readFileSync(join(LIB, "personas", f), "utf8");
    assert.match(text, /^# .+\n\n\S/, `${f}: title then an opening paragraph`);
    assert.match(text, /\n## Never\n/, `${f}: a Never section`);
    assert.match(text, /\n## (Status|Report)\n/, `${f}: a Status or Report section`);
  }
});
