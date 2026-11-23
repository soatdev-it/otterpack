// otterpack list: the templates, personas and kits a library offers, each with one line
// about it. Inside a project it reads the library at the pinned commit, and adds the
// project's local personas and kits; outside one, the library's latest commit.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import { loadTeam } from "./config.js";
import { checkout, latestCommit, librarySource } from "./library.js";
import { readLock } from "./sync.js";
import { DEFAULT_LIBRARY } from "./init.js";
const plain = (s) => s.replace(/\*\*|__|`/g, "").trim();
const firstSentence = (s) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();
const entries = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
/** "Title: first sentence of the first paragraph". */
function personaAbout(file) {
    const lines = readFileSync(file, "utf8").split("\n");
    const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim();
    const para = lines.find((l) => l.trim() && !l.startsWith("#"));
    const first = para ? firstSentence(plain(para)) : "";
    return [title, first].filter(Boolean).join(": ");
}
/** The first sentence of a template's leading comment, without its "# <id>:" prefix. */
function templateAbout(id, text) {
    const lines = text.split("\n");
    const head = [];
    for (const l of lines) {
        if (!l.startsWith("#"))
            break;
        head.push(l.replace(/^#\s*/, ""));
    }
    return firstSentence(head.join(" ").replace(new RegExp(`^${id}:\\s*`), ""));
}
function kitInfo(id, dir, local, used) {
    const readme = join(dir, "README.md");
    const about = existsSync(readme) ? plain(readFileSync(readme, "utf8").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "") : "";
    return {
        id, about, local, inUse: used.has(id),
        skills: entries(join(dir, "skills")).length,
        agents: entries(join(dir, "agents")).filter((f) => f.endsWith(".md")).length,
    };
}
export function listLibrary(opts = {}) {
    const home = opts.home ?? homedir();
    const team = opts.root ? loadTeam(opts.root) : undefined;
    const base = opts.root ?? process.cwd();
    const source = librarySource(team?.library ?? opts.library ?? process.env.OTTERPACK_LIBRARY ?? DEFAULT_LIBRARY, base);
    const commit = (opts.root && readLock(opts.root)?.library.commit) || latestCommit(source, home);
    const usedPersonas = new Set(team?.seats.map((s) => s.persona) ?? []);
    const usedKits = new Set(team?.kits ?? []);
    const lib = checkout(source, commit, home);
    try {
        const templates = entries(join(lib.path, "templates"))
            .filter((f) => f.endsWith(".yaml"))
            .map((f) => {
            const id = f.slice(0, -5);
            const text = readFileSync(join(lib.path, "templates", f), "utf8");
            const seats = (parse(text)?.seats ?? []).map((s) => `${s.id} (${s.persona})`);
            return { id, about: templateAbout(id, text), seats };
        });
        const personas = new Map();
        for (const f of entries(join(lib.path, "personas")).filter((f) => f.endsWith(".md"))) {
            const id = f.slice(0, -3);
            personas.set(id, { id, about: personaAbout(join(lib.path, "personas", f)), local: false, inUse: usedPersonas.has(id) });
        }
        const kits = new Map();
        for (const id of entries(join(lib.path, "kits")))
            kits.set(id, kitInfo(id, join(lib.path, "kits", id), false, usedKits));
        if (opts.root) {
            // A local persona with a library persona's name is that persona's addendum, not a new one.
            const localPersonas = join(opts.root, ".otterpack/local/personas");
            for (const f of entries(localPersonas).filter((f) => f.endsWith(".md"))) {
                const id = f.slice(0, -3);
                if (!personas.has(id))
                    personas.set(id, { id, about: personaAbout(join(localPersonas, f)), local: true, inUse: usedPersonas.has(id) });
            }
            // A local kit replaces the library kit of the same name (as in sync).
            const localKits = join(opts.root, ".otterpack/local/kits");
            for (const id of entries(localKits))
                kits.set(id, kitInfo(id, join(localKits, id), true, usedKits));
        }
        const byId = (m) => [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
        return { source, commit, templates, personas: byId(personas), kits: byId(kits) };
    }
    finally {
        lib.dispose();
    }
}
