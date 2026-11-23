// The library: a git repo (URL or local path) whose library/ folder holds personas, kits
// and templates. It is read at a pinned commit through a bare mirror in ~/.otterpack/cache.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
export class LibraryError extends Error {
}
/** A relative library path in team.yaml is relative to the project root. */
export function librarySource(source, root) {
    if (/^[a-z+]+:\/\//.test(source) || /^[^/]+@[^:]+:/.test(source) || isAbsolute(source))
        return source;
    return resolve(root, source);
}
function gitRun(args, cwd) {
    try {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    }
    catch (e) {
        throw new LibraryError(`git ${args.join(" ")} failed: ${(e.stderr || e.message || "").toString().trim()}`);
    }
}
function mirror(source, home, fetch) {
    const dir = join(home, ".otterpack", "cache", createHash("sha1").update(source).digest("hex").slice(0, 16) + ".git");
    if (!existsSync(dir)) {
        mkdirSync(join(home, ".otterpack", "cache"), { recursive: true });
        gitRun(["clone", "--quiet", "--mirror", source, dir]);
    }
    else if (fetch) {
        gitRun(["--git-dir", dir, "remote", "update", "--prune"]);
    }
    return dir;
}
function hasCommit(dir, commit) {
    try {
        execFileSync("git", ["--git-dir", dir, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
/** Latest commit of the library's default branch (fetches first). */
export function latestCommit(source, home) {
    const dir = mirror(source, home, true);
    return gitRun(["--git-dir", dir, "rev-parse", "HEAD"]);
}
/** Extract library/ at `commit` into a fresh temp folder. Call dispose() when done. */
export function checkout(source, commit, home) {
    let dir = mirror(source, home, false);
    if (!hasCommit(dir, commit)) {
        dir = mirror(source, home, true);
        if (!hasCommit(dir, commit))
            throw new LibraryError(`commit ${commit} is not in the library ${source}`);
    }
    const out = mkdtempSync(join(tmpdir(), "otterpack-library-"));
    try {
        const tar = execFileSync("git", ["--git-dir", dir, "archive", "--format=tar", commit, "library"], { maxBuffer: 1 << 30 });
        execFileSync("tar", ["-x", "-C", out], { input: tar });
    }
    catch (e) {
        rmSync(out, { recursive: true, force: true });
        throw new LibraryError(`could not read library/ at ${commit} from ${source}: ${(e.stderr || e.message || "").toString().trim()}`);
    }
    return { path: join(out, "library"), dispose: () => rmSync(out, { recursive: true, force: true }) };
}
/** One line per library commit in (from, to], newest first, touching library/. */
export function libraryLog(source, from, to, home) {
    if (from === to)
        return [];
    const dir = mirror(source, home, false);
    const out = gitRun(["--git-dir", dir, "log", "--format=%h %s", `${from}..${to}`, "--", "library"]);
    return out ? out.split("\n") : [];
}
