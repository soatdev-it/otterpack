// Shared test helpers: temp dirs, a throwaway library git repo, a project folder.
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { teamHash, LOCK_FILE } from "../src/sync.ts";

export function tmp(prefix = "otterpack-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>, executable: string[] = []): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    if (executable.includes(rel)) chmodSync(p, 0o755);
  }
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

/** A git repo laid out like this one: everything under library/. Returns its path. */
export function libraryRepo(files: Record<string, string>, executable: string[] = []): string {
  const dir = tmp("otterpack-lib-");
  git(dir, "init", "-q", "-b", "main");
  writeFiles(join(dir, "library"), files, executable.map((e) => e));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "library");
  return dir;
}

export function commitLibrary(repo: string, files: Record<string, string>): string {
  writeFiles(join(repo, "library"), files);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
  return git(repo, "rev-parse", "HEAD");
}

export function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

export function exists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

/** A project with .otterpack/team.yaml. */
export function project(teamYaml: string, files: Record<string, string> = {}): string {
  const dir = tmp("otterpack-proj-");
  writeFiles(dir, { ".otterpack/team.yaml": teamYaml, ...files });
  return dir;
}

/** Isolated HOME so tests never touch the real ~/.otterpack, ~/.claude or ~/.codex. */
export function fakeHome(): string {
  return tmp("otterpack-home-");
}

/** A lock as a finished sync of the current team.yaml leaves it, for tests that don't need a library. */
export function markSynced(root: string): void {
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ library: { source: "test", commit: "0".repeat(40) }, files: {}, team: teamHash(root) }));
}
