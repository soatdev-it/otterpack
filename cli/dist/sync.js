// otterpack sync: write the generated files for the pinned library commit.
// It owns exactly the files listed in .otterpack/lock.json. Anything else is never touched:
// a file it would write that it didn't generate, or a generated file edited by hand, stops
// the sync before anything is written.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { loadTeam, TEAM_FILE } from "./config.js";
import { renderTasks } from "./tasks.js";
import { checkout, latestCommit, librarySource } from "./library.js";
export const LOCK_FILE = ".otterpack/lock.json";
/** One folder per seat for its notes and state files. Created by sync, never removed by it. */
export const SEATS_DIR = ".otterpack/seats";
/** Where sync --replace moves what was in the way, one folder per run. Gitignored. */
export const REPLACED_DIR = ".otterpack/replaced";
export class SyncConflict extends Error {
    conflicts;
    constructor(conflicts) {
        super("sync stopped, nothing was written:\n" +
            conflicts.map((c) => `  ${c.path}: ${c.reason}`).join("\n") +
            "\nRemove or move these files, then run sync again, or run otterpack sync --replace to move them to .otterpack/replaced/ for you.");
        this.conflicts = conflicts;
    }
}
export class SyncError extends Error {
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function readLock(root) {
    const p = join(root, LOCK_FILE);
    if (!existsSync(p))
        return undefined;
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        throw new SyncError(`${LOCK_FILE} is not valid JSON (a merge conflict?): restore it from git (git checkout -- ${LOCK_FILE}), then run otterpack sync`);
    }
}
/** Kind of an entry, following symlinks (kits may link shared files). */
function kind(path) {
    try {
        const st = statSync(path);
        return st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
    }
    catch {
        throw new SyncError(`broken symlink in a kit: ${path}`);
    }
}
function walk(dir, rel = "", depth = 0) {
    if (depth > 32)
        throw new SyncError(`folders nested too deep (a symlink loop?) at ${join(dir, rel)}`);
    const out = [];
    for (const name of readdirSync(join(dir, rel)).sort()) {
        const r = rel ? `${rel}/${name}` : name;
        const k = kind(join(dir, r));
        if (k === "dir")
            out.push(...walk(dir, r, depth + 1));
        else if (k === "file")
            out.push(r);
    }
    return out;
}
function fileOut(path) {
    return { content: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0 };
}
/** Everything sync should write, keyed by project-relative path. */
export function plan(root, team, lib) {
    const out = new Map();
    const owner = new Map(); // "skill x" / "agent y" -> kit
    for (const kit of team.kits) {
        const local = join(root, ".otterpack/local/kits", kit);
        const fromLib = join(lib, "kits", kit);
        const dir = existsSync(local) ? local : existsSync(fromLib) ? fromLib : undefined;
        if (!dir)
            throw new SyncError(`kit "${kit}" is neither in the library nor in .otterpack/local/kits`);
        const claim = (what) => {
            const prev = owner.get(what);
            if (prev)
                throw new SyncError(`${what} comes from both kit ${prev} and kit ${kit}`);
            owner.set(what, kit);
        };
        if (existsSync(join(dir, "skills"))) {
            for (const skill of readdirSync(join(dir, "skills")).sort()) {
                if (kind(join(dir, "skills", skill)) !== "dir")
                    continue;
                claim(`skill "${skill}"`);
                for (const f of walk(join(dir, "skills", skill))) {
                    const o = fileOut(join(dir, "skills", skill, f));
                    out.set(`.agents/skills/${skill}/${f}`, o);
                    out.set(`.claude/skills/${skill}/${f}`, o);
                }
            }
        }
        if (existsSync(join(dir, "agents"))) {
            for (const f of readdirSync(join(dir, "agents")).sort()) {
                if (!f.endsWith(".md") || kind(join(dir, "agents", f)) !== "file")
                    continue;
                claim(`agent "${f}"`);
                out.set(`.claude/agents/${f}`, fileOut(join(dir, "agents", f)));
            }
        }
    }
    for (const persona of new Set(team.seats.map((s) => s.persona).filter((p) => p !== "none"))) {
        const fromLib = join(lib, "personas", `${persona}.md`);
        const local = join(root, ".otterpack/local/personas", `${persona}.md`);
        const src = existsSync(fromLib) ? fromLib : existsSync(local) ? local : undefined;
        if (!src)
            throw new SyncError(`persona "${persona}" is neither in the library nor in .otterpack/local/personas`);
        out.set(`.otterpack/personas/${persona}.md`, { content: readFileSync(src), executable: false });
    }
    out.set(".vscode/tasks.json", { content: Buffer.from(renderTasks(team)), executable: false });
    out.set(".otterpack/.gitignore", { content: Buffer.from("state/\nreplaced/\n"), executable: false });
    return out;
}
function removeEmptyParents(root, rel) {
    let dir = dirname(rel);
    while (dir !== "." && dir !== "") {
        const abs = join(root, dir);
        if (!existsSync(abs) || readdirSync(abs).length > 0)
            return;
        rmdirSync(abs);
        dir = dirname(dir);
    }
}
function writeAtomic(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.otterpack-tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, path);
}
function writeLock(root, lock) {
    const text = JSON.stringify(lock, null, 2) + "\n";
    const path = join(root, LOCK_FILE);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text)
        writeAtomic(path, text);
}
/** The first symlink on the way from root to rel (the file itself included), if any. */
function symlinkOnPath(root, rel) {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("/");
        let st;
        try {
            st = lstatSync(join(root, prefix));
        }
        catch {
            return undefined; // does not exist yet: nothing below it can be a link
        }
        if (st.isSymbolicLink())
            return prefix;
    }
    return undefined;
}
function isExecutable(abs) {
    return (statSync(abs).mode & 0o111) !== 0;
}
export function sync(root, opts = {}) {
    const home = opts.home ?? homedir();
    const hash = teamHash(root); // of the team.yaml this sync reads, should it change meanwhile
    const team = loadTeam(root);
    const source = librarySource(team.library, root);
    const old = readLock(root);
    const oldFiles = old?.files ?? {};
    // A path is ours if its content matches what the lock recorded, or (after a sync that
    // failed half-way) the previous content recorded as pending.
    const ours = (path, hash) => oldFiles[path] === hash || old?.pending?.[path] === hash;
    // The pin only moves through update (opts.commit). Editing the library: value keeps it.
    const commit = opts.commit ?? old?.library.commit ?? latestCommit(source, home);
    let lib;
    try {
        lib = checkout(source, commit, home);
    }
    catch (e) {
        if (!opts.commit && old && old.library.source !== team.library) {
            throw new SyncError(`the pinned commit ${commit.slice(0, 12)} is not in ${team.library} (library: changed from ${old.library.source}); run otterpack update to pin its latest commit`);
        }
        throw e;
    }
    let want;
    try {
        want = plan(root, team, lib.path);
    }
    finally {
        lib.dispose();
    }
    const conflicts = [];
    const movable = new Set(); // conflicts --replace may move (never a symlink)
    const toWrite = [];
    const toRemove = [];
    const tracked = new Set([...Object.keys(oldFiles), ...Object.keys(old?.pending ?? {})]);
    for (const [path, o] of want) {
        const link = symlinkOnPath(root, path);
        if (link) {
            conflicts.push({ path, reason: `goes through the symlink ${link}` });
            continue;
        }
        const abs = join(root, path);
        const onDisk = existsSync(abs) ? readFileSync(abs) : undefined;
        if (onDisk === undefined)
            toWrite.push(path);
        else if (!tracked.has(path)) {
            conflicts.push({ path, reason: "exists and was not generated by otterpack" });
            movable.add(path);
        }
        else if (!ours(path, sha(onDisk)) && !onDisk.equals(o.content)) {
            conflicts.push({ path, reason: "edited since the last sync" });
            movable.add(path);
        }
        else if (!onDisk.equals(o.content) || isExecutable(abs) !== o.executable)
            toWrite.push(path);
    }
    for (const path of tracked) {
        if (want.has(path))
            continue;
        const abs = join(root, path);
        if (symlinkOnPath(root, path)) {
            conflicts.push({ path, reason: `goes through the symlink ${symlinkOnPath(root, path)}` });
            continue;
        }
        if (!existsSync(abs))
            continue;
        if (!ours(path, sha(readFileSync(abs)))) {
            conflicts.push({ path, reason: "edited since the last sync, and no longer generated" });
            movable.add(path);
        }
        else
            toRemove.push(path);
    }
    const blocking = opts.replace ? conflicts.filter((c) => !movable.has(c.path)) : conflicts;
    if (blocking.length)
        throw new SyncConflict(blocking);
    // --replace: move what is in the way to a backup, then write as if it had never been there.
    const replaced = [];
    let backup;
    const prune = opts.replace && opts.prune ? unmanaged(root, want) : [];
    if (conflicts.length || prune.length) {
        backup = `${REPLACED_DIR}/${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const units = new Set([...conflicts.map((c) => unitOf(c.path, tracked)), ...prune]);
        for (const unit of [...units].sort()) {
            const dest = join(root, backup, unit);
            mkdirSync(dirname(dest), { recursive: true });
            renameSync(join(root, unit), dest);
            removeEmptyParents(root, unit);
            replaced.push(unit);
            for (const p of want.keys())
                if ((p === unit || p.startsWith(`${unit}/`)) && !toWrite.includes(p))
                    toWrite.push(p);
        }
    }
    const files = {};
    for (const path of [...want.keys()].sort())
        files[path] = sha(want.get(path).content);
    // Record the intent first: a write that fails half-way leaves a lock that still owns
    // every path, under its old hash (pending) or its new one (files).
    if (toWrite.length || toRemove.length) {
        const pending = {};
        for (const p of [...toWrite, ...toRemove])
            if (oldFiles[p])
                pending[p] = oldFiles[p];
        writeLock(root, {
            library: old?.library ?? { source: team.library, commit },
            files: { ...oldFiles, ...files },
            pending,
        });
    }
    for (const path of toWrite) {
        const abs = join(root, path);
        const o = want.get(path);
        writeAtomic(abs, o.content);
        chmodSync(abs, o.executable ? 0o755 : 0o644);
    }
    for (const path of toRemove) {
        try {
            unlinkSync(join(root, path));
        }
        catch (e) {
            if (e.code !== "ENOENT")
                throw e;
        }
        removeEmptyParents(root, path);
    }
    for (const s of team.seats)
        ensureSeatFolder(root, s.id);
    writeLock(root, { library: { source: team.library, commit }, files, team: hash });
    return { commit, written: toWrite, removed: toRemove, replaced, backup, unmanaged: opts.replace ? unmanaged(root, want) : [] };
}
/** Of team.yaml's content, not its bytes: comments, layout and line endings don't count. */
export function teamHash(root) {
    return sha(Buffer.from(JSON.stringify(parseYaml(readFileSync(join(root, TEAM_FILE), "utf8")) ?? null)));
}
/** Why the generated files may not match team.yaml, or undefined when they do. */
export function syncProblem(root) {
    const lock = readLock(root);
    if (!lock)
        return "not synced yet: run otterpack sync";
    if (lock.pending)
        return "the last sync did not finish: run otterpack sync";
    if (lock.team === undefined)
        return "synced by an older otterpack: run otterpack sync";
    if (lock.team !== teamHash(root))
        return "team.yaml changed since the last sync: run otterpack sync";
    return undefined;
}
/** The seat's folder, with a .gitkeep while it is empty so a fresh checkout still has it. */
export function ensureSeatFolder(root, id) {
    const dir = join(root, SEATS_DIR, id);
    mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length === 0)
        writeFileSync(join(dir, ".gitkeep"), "");
}
/**
 * What --replace moves for a conflict: a hand-made skill's whole folder (so none of its
 * extra files end up mixed into the generated skill), otherwise just the file.
 */
function unitOf(path, tracked) {
    const m = /^(\.claude\/skills|\.agents\/skills)\/([^/]+)\//.exec(path);
    if (!m)
        return path;
    const dir = `${m[1]}/${m[2]}`;
    return [...tracked].some((t) => t.startsWith(`${dir}/`)) ? path : dir;
}
/** Agents and skills sync doesn't own in the folders it writes to. */
function unmanaged(root, want) {
    const out = [];
    for (const base of [".claude/agents", ".claude/skills", ".agents/skills"]) {
        if (!existsSync(join(root, base)))
            continue;
        for (const name of readdirSync(join(root, base))) {
            const p = `${base}/${name}`;
            if (!want.has(p) && ![...want.keys()].some((k) => k.startsWith(`${p}/`)))
                out.push(p);
        }
    }
    return out.sort();
}
