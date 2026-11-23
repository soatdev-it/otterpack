#!/usr/bin/env node
// otterpack: the right team of coding agents for each project, evolving with it.
import { readFileSync } from "node:fs";
import { ConfigError, findRoot, loadTeam } from "./config.js";
import { LibraryError } from "./library.js";
import { sync, SyncConflict, SyncError } from "./sync.js";
import { up } from "./up.js";
import { launch } from "./launch.js";
import { init, DEFAULT_TEMPLATE } from "./init.js";
import { update } from "./update.js";
import { doctor } from "./doctor.js";
import { listLibrary } from "./list.js";
import { addSeat, removeSeat, resetSeat, status, stopSeats, reportLines, disableSeat, enableSeat, addKit, removeKit, rebriefNotice } from "./manage.js";
const USAGE = `usage: otterpack <command>   (otterpack --version: the installed version)

set up:
  init [--template <t>] [--library <git-url|path>] [--name <n>] [--replace [--prune]]
                                     write .otterpack/team.yaml from a template (default ${DEFAULT_TEMPLATE}), then sync
  sync [--replace [--prune]]         write the generated files for team.yaml and the pinned library commit;
                                     --replace moves hand-made files in the way to .otterpack/replaced/,
                                     --prune also the hand-made agents and skills no kit replaces
  update                             move the pin to the library's latest commit, show what changes, sync
  doctor                             check tmux, CLIs, logins, Codex sandbox, persistence, library, sync
  list [--library <git-url|path>]    the templates, personas and kits to choose from (in a project: at its pinned
                                     library commit, with its local ones, and * for what the team uses)

run the seats:
  status                             each seat: running or stopped, harness, persona, conversation
  up [seat…] [--no-attach|--dry-run] start (or resume) seats in tmux; one seat: attach to it
  stop [seat…]                       stop seats (all if none named); conversations are kept
  reset <seat>                       stop a seat and forget its conversation: the next up starts afresh

change the team:
  add <seat> --persona <p|none> [--label <l>] [--harness claude|codex] [--icon <i>] [--color <c>] [--cwd <dir>]
                                     add a seat to team.yaml and sync
  remove <seat> [--keep-conversation] stop a seat, drop it from team.yaml and sync (its seat folder is kept)
  disable <seat>                     stop a seat and keep it off (no terminal, not started by up); all its files are kept
  enable <seat>                      undo disable: the seat starts again on the next reload or up
  kit add|remove <kit>               add a kit (library, or .otterpack/local/kits/<kit>/) to kits: or take it out, and sync

`;
const NEXT = "Next: commit .otterpack/ and the generated files, then Reload the VS Code window (Developer: Reload Window)\n" +
    "to open one terminal per seat; allow the folder's automatic tasks when VS Code asks. Without VS Code: otterpack up.";
class UsageError extends Error {
}
function notice(root) {
    const n = rebriefNotice(root);
    if (n)
        console.log(`otterpack: ${n}`);
}
function report(r) {
    const [first, ...rest] = reportLines(r);
    console.log(`otterpack: ${first}`);
    for (const l of rest)
        console.log(l);
    if (r.backup && r.replaced?.length) {
        const n = r.replaced.length;
        console.log(`otterpack: moved ${n} hand-made path${n === 1 ? "" : "s"} to ${r.backup}/ (gitignored; delete it once you're happy):`);
        for (const p of r.replaced)
            console.log(`  ~ ${p}`);
    }
    if (r.unmanaged?.length) {
        console.log(`otterpack: left as they were, not from any kit (keep one by moving it to .otterpack/local/kits/<kit>/; --prune moves the rest to the backup):`);
        for (const p of r.unmanaged)
            console.log(`  ? ${p}`);
    }
}
/** Whatever is left after the flags were taken: no options, at most `max` (and at least `min`) seat ids. */
function seatArgs(args, cmd, min, max) {
    const opt = args.find((a) => a.startsWith("-"));
    if (opt)
        throw new UsageError(`unknown option ${opt}`);
    if (args.length < min || args.length > max) {
        const what = cmd.startsWith("kit") ? "kit" : "seat id";
        throw new UsageError(max === 0 ? `${cmd} takes no arguments (got ${args[0]})` : min === max ? `${cmd} needs exactly one ${what}` : `${cmd}: too many arguments`);
    }
    return args;
}
function replaceFlags(args, cmd) {
    const replace = args.includes("--replace");
    const prune = args.includes("--prune");
    seatArgs(args.filter((a) => a !== "--replace" && a !== "--prune"), cmd, 0, 0);
    if (prune && !replace)
        throw new UsageError("--prune goes with --replace");
    return { replace, prune };
}
const say = (l) => console.log(l.startsWith("  ") ? l : `otterpack: ${l}`);
/** stop, reset and remove may end the tmux pane they run in: finish the work regardless. */
const surviveOwnPane = () => process.on("SIGHUP", () => { });
function flag(args, name) {
    const i = args.indexOf(name);
    if (i < 0)
        return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith("--"))
        throw new UsageError(`${name} needs a value`);
    args.splice(i, 2);
    return v;
}
export async function main(argv) {
    const [cmd, ...rest] = argv;
    switch (cmd) {
        case "init": {
            const template = flag(rest, "--template");
            const library = flag(rest, "--library");
            const name = flag(rest, "--name");
            const { replace, prune } = replaceFlags(rest, "init");
            const out = init(process.cwd(), { template, library, name });
            console.log(`otterpack: wrote ${out}`);
            report(sync(process.cwd(), { replace, prune }));
            console.log(NEXT);
            return 0;
        }
        case "sync": {
            const { replace, prune } = replaceFlags(rest, "sync");
            const root = findRoot();
            report(sync(root, { replace, prune }));
            notice(root);
            return 0;
        }
        case "update": {
            const root = findRoot();
            const r = update(root);
            if (r.from === r.to) {
                console.log(`otterpack: already at the library's latest commit ${r.to.slice(0, 12)}`);
                if (r.written.length || r.removed.length || r.adopted.length)
                    report({ commit: r.to, written: r.written, removed: r.removed, adopted: r.adopted });
                return 0;
            }
            console.log(`otterpack: library ${r.from ? r.from.slice(0, 12) : "(unpinned)"} -> ${r.to.slice(0, 12)}`);
            for (const l of r.log)
                console.log(`  ${l}`);
            report({ commit: r.to, written: r.written, removed: r.removed, adopted: r.adopted });
            notice(root);
            console.log("Review with git diff, then commit.");
            return 0;
        }
        case "list": {
            const library = flag(rest, "--library");
            seatArgs(rest, "list", 0, 0);
            let root;
            if (!library)
                try {
                    root = findRoot();
                }
                catch (e) {
                    if (!(e instanceof ConfigError))
                        throw e;
                }
            const l = listLibrary({ root, library });
            const mark = (x) => (x.inUse ? "*" : " ") + (x.local ? " (local)" : "");
            const pad = (rows) => {
                const w = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i].length))) ?? [];
                return rows.map((r) => ("  " + r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join("  ")).trimEnd());
            };
            const n = (k, what) => (k ? `${k} ${what}${k === 1 ? "" : "s"}` : "");
            console.log(`library ${l.source} at ${l.commit.slice(0, 12)}${root ? " (pinned by this project; * = used by its team)" : ""}`);
            console.log("\ntemplates (otterpack init --template <t>):");
            for (const t of l.templates) {
                console.log(pad([[t.id, t.about]])[0]);
                console.log(`      seats: ${t.seats.join(", ")}`);
            }
            console.log("\npersonas (otterpack add <seat> --persona <p>):");
            for (const line of pad(l.personas.map((p) => [p.id + mark(p).trimEnd(), p.about])))
                console.log(line);
            console.log("\nkits (otterpack kit add <kit>):");
            for (const line of pad(l.kits.map((k) => [k.id + mark(k).trimEnd(), [n(k.skills, "skill"), n(k.agents, "agent")].filter(Boolean).join(", "), k.about])))
                console.log(line);
            return 0;
        }
        case "doctor": {
            let root;
            try {
                root = findRoot();
            }
            catch {
                root = undefined;
            }
            const checks = doctor(root);
            const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
            const w = Math.max(...checks.map((c) => c.name.length));
            for (const c of checks)
                console.log(`${mark[c.status]}  ${c.name.padEnd(w)}  ${c.detail}`);
            const failed = checks.filter((c) => c.status === "fail").length;
            console.log(failed ? `otterpack: ${failed} check(s) failed` : "otterpack: all checks passed");
            return failed ? 1 : 0;
        }
        case "up": {
            const dryRun = rest.includes("--dry-run");
            const noAttach = rest.includes("--no-attach") || dryRun;
            const unknown = rest.filter((a) => a.startsWith("-") && a !== "--dry-run" && a !== "--no-attach");
            if (unknown.length)
                throw new UsageError(`unknown option ${unknown[0]}`);
            const seats = rest.filter((a) => !a.startsWith("-"));
            await up(findRoot(), seats, { attach: !noAttach, dryRun, onLine: (l) => console.log(dryRun ? l : `otterpack: ${l}`) });
            return 0;
        }
        case "status": {
            seatArgs(rest, "status", 0, 0);
            const s = status(findRoot());
            const state = (r) => r.state === "running" ? `running (${r.command})` : r.state === "other project" ? `stopped; "${r.id}" is another project's session (${r.where})` : r.state;
            const rows = s.seats.map((r) => [r.id, r.label, r.harness, r.persona, state(r), r.conversation ?? "-"]);
            const head = ["SEAT", "LABEL", "HARNESS", "PERSONA", "STATE", "CONVERSATION"];
            const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
            for (const r of [head, ...rows])
                console.log(r.map((c, i) => (i === 4 ? c.padEnd(Math.min(w[i], 16)) : c.padEnd(w[i]))).join("  ").trimEnd());
            for (const r of s.seats) {
                if (!r.briefChanges)
                    continue;
                const live = r.state === "running" || r.state === "bare shell";
                console.log(`otterpack: ${r.id}'s brief changed since it last read it (${r.briefChanges.join("; ")}). It gets a re-brief when it next starts` +
                    (live ? `; to give it now, restart it: otterpack stop ${r.id}, then otterpack up ${r.id} (or reopen its terminal).` : "."));
            }
            if (s.syncProblem)
                console.log(`otterpack: ${s.syncProblem}`);
            return 0;
        }
        case "stop": {
            const ids = seatArgs(rest, "stop", 0, Infinity);
            surviveOwnPane();
            stopSeats(findRoot(), ids, { onLine: say });
            return 0;
        }
        case "reset": {
            const [id] = seatArgs(rest, "reset", 1, 1);
            surviveOwnPane();
            resetSeat(findRoot(), id, { onLine: say });
            return 0;
        }
        case "kit": {
            const [action, ...args] = rest;
            if (action !== "add" && action !== "remove")
                throw new UsageError("kit needs add or remove");
            const [kit] = seatArgs(args, `kit ${action}`, 1, 1);
            report((action === "add" ? addKit : removeKit)(findRoot(), kit));
            return 0;
        }
        case "disable": {
            const [id] = seatArgs(rest, "disable", 1, 1);
            surviveOwnPane();
            disableSeat(findRoot(), id, { onLine: say });
            return 0;
        }
        case "enable": {
            const [id] = seatArgs(rest, "enable", 1, 1);
            enableSeat(findRoot(), id, { onLine: say });
            return 0;
        }
        case "add": {
            const persona = flag(rest, "--persona");
            const label = flag(rest, "--label");
            const harness = flag(rest, "--harness");
            const icon = flag(rest, "--icon");
            const color = flag(rest, "--color");
            const cwd = flag(rest, "--cwd");
            const [id] = seatArgs(rest, "add", 1, 1);
            if (!persona)
                throw new UsageError("add needs --persona <id> (a file in the library's personas/ or .otterpack/local/personas/), or --persona none");
            if (harness !== undefined && harness !== "claude" && harness !== "codex")
                throw new UsageError("--harness must be claude or codex");
            report(addSeat(findRoot(), { id, persona, label, harness: harness, icon, color, cwd }));
            console.log(`otterpack: seat ${id} added. Start it: reload the VS Code window (its terminal opens), or otterpack up ${id}`);
            return 0;
        }
        case "remove": {
            const keepConversation = rest.includes("--keep-conversation");
            const [id] = seatArgs(rest.filter((a) => a !== "--keep-conversation"), "remove", 1, 1);
            surviveOwnPane();
            removeSeat(findRoot(), id, { keepConversation, onLine: say });
            return 0;
        }
        case "launch": {
            // Typed into a seat's shell by `up`; not meant to be run by hand.
            const root = flag(rest, "--root") ?? findRoot();
            const [seat] = rest;
            if (!seat)
                throw new UsageError("launch needs a seat id");
            return launch(root, seat);
        }
        case "-v":
        case "--version":
            // package.json is two levels up from both cli/src and cli/dist.
            console.log(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version);
            return 0;
        case undefined:
        case "-h":
        case "--help":
            process.stdout.write(USAGE);
            return cmd === undefined ? 1 : 0;
        default:
            throw new UsageError(`unknown command "${cmd}"`);
    }
}
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    if (e instanceof UsageError) {
        process.stderr.write(`otterpack: ${e.message}\n${USAGE}`);
        process.exitCode = 1;
        return;
    }
    const known = e instanceof ConfigError || e instanceof SyncConflict || e instanceof SyncError || e instanceof LibraryError;
    if (!(e instanceof Error) || (!known && !("code" in e)) || process.env.OTTERPACK_DEBUG)
        throw e;
    // Known errors and file-system errors (EACCES, ENOSPC…): one line, no stack trace.
    process.stderr.write(`otterpack: ${e.message}\n`);
    process.exitCode = 1;
});
