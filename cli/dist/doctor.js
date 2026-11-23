// otterpack doctor: what the seats need, checked in one command. Logins are checked
// by asking each CLI, never by reading its credential files.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadTeam } from "./config.js";
import { librarySource } from "./library.js";
import { syncProblem } from "./sync.js";
function sh(cmd, args, env, timeout = 30_000) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", timeout });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return { ok: !r.error && r.status === 0, out, missing: r.error?.code === "ENOENT" };
}
function firstLine(s) {
    return s.split("\n")[0] ?? "";
}
function mountPoints(info) {
    // mountinfo field 5 is the mount point (octal escapes for spaces etc.)
    return new Set(info.split("\n").filter(Boolean).map((l) => l.split(" ")[4]?.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))));
}
export function doctor(root, opts = {}) {
    const env = opts.env ?? process.env;
    const home = env.HOME ?? "";
    const checks = [];
    const add = (name, status, detail) => checks.push({ name, status, detail });
    for (const [tool, args] of [["tmux", ["-V"]], ["git", ["--version"]]]) {
        const r = sh(tool, [...args], env);
        add(tool, r.ok ? "ok" : "fail", r.ok ? firstLine(r.out) : r.missing ? "not installed" : r.out);
    }
    let uid = "?";
    try {
        uid = String(process.getuid?.());
    }
    catch { /* not on this platform */ }
    let homeOk = !!home;
    try {
        if (home)
            accessSync(home, constants.W_OK);
    }
    catch {
        homeOk = false;
    }
    add("user and $HOME", homeOk ? "ok" : "fail", homeOk ? `uid ${uid}, HOME=${home}` : `HOME=${home || "(unset)"} is not writable`);
    let team;
    if (root) {
        try {
            team = loadTeam(root);
            add("team.yaml", "ok", `${team.seats.length} seats, ${team.kits.length} kits`);
            const problem = syncProblem(root);
            add("sync", problem ? "fail" : "ok", problem ?? "generated files match team.yaml");
        }
        catch (e) {
            add("team.yaml", "fail", e.message);
        }
    }
    else {
        add("team.yaml", "warn", "no .otterpack/team.yaml here (run otterpack init)");
    }
    const active = team?.seats.filter((s) => !s.disabled) ?? [];
    const harnesses = new Set(active.map((s) => s.harness));
    if (harnesses.has("claude")) {
        const v = sh("claude", ["--version"], env);
        add("claude CLI", v.ok ? "ok" : "fail", v.ok ? firstLine(v.out) : v.missing ? "not installed or not on PATH" : v.out);
        if (v.ok) {
            const s = sh("claude", ["auth", "status"], env);
            let logged = false;
            try {
                logged = JSON.parse(s.out).loggedIn === true;
            }
            catch { /* not JSON */ }
            add("claude login", logged ? "ok" : "fail", logged ? "logged in" : "not logged in: run claude, then /login");
        }
    }
    if (harnesses.has("codex")) {
        const v = sh("codex", ["--version"], env);
        add("codex CLI", v.ok ? "ok" : "fail", v.ok ? firstLine(v.out) : v.missing ? "not installed or not on PATH" : v.out);
        if (v.ok) {
            const s = sh("codex", ["login", "status"], env);
            const logged = s.ok && /logged in/i.test(s.out) && !/not logged in/i.test(s.out);
            add("codex login", logged ? "ok" : "fail", logged ? firstLine(s.out) : "not logged in: run codex login --device-auth");
            const sb = sh("codex", ["sandbox", "--", "true"], env);
            add("codex sandbox", sb.ok ? "ok" : "fail", sb.ok ? "workspace sandbox works" : `codex sandbox -- true failed: ${firstLine(sb.out).replace(/\.+$/, "")}. Codex seats with sandbox_mode = "workspace-write" can't run commands here`);
        }
    }
    for (const s of active) {
        if (!s.launcher)
            continue;
        const p = join(root, s.launcher);
        let ok = false;
        try {
            accessSync(p, constants.X_OK);
            ok = true;
        }
        catch { /* missing or not executable */ }
        add(`launcher ${s.id}`, ok ? "ok" : "fail", ok ? s.launcher : `${s.launcher} is missing or not executable`);
    }
    const inContainer = opts.inContainer ?? (existsSync("/.dockerenv") || existsSync("/run/.containerenv"));
    if (inContainer) {
        let info = opts.mountinfo;
        if (info === undefined) {
            try {
                info = readFileSync("/proc/self/mountinfo", "utf8");
            }
            catch {
                info = "";
            }
        }
        const mounts = mountPoints(info);
        // Persistent if the folder or one of its parents is a mount, other than the
        // container's own root filesystem.
        const mountOf = (dir) => {
            let p = dir;
            try {
                p = realpathSync(dir);
            }
            catch { /* not there yet */ }
            for (let d = p; d !== "/" && d !== "."; d = dirname(d))
                if (mounts.has(d))
                    return d;
            return undefined;
        };
        const persists = (name, dir, lost) => {
            const m = mountOf(dir);
            add(`${name} survives a rebuild`, m ? "ok" : "warn", m ? `on the mount ${m}` : `${dir} is on no volume or bind mount: ${lost} are lost on rebuild`);
        };
        for (const h of harnesses)
            persists(`~/.${h}`, join(home, `.${h}`), "logins and conversations");
        if (root)
            persists(".otterpack/state", join(root, ".otterpack/state"), "the seat to conversation ids");
    }
    if (team && root) {
        const src = librarySource(team.library, root);
        const r = sh("git", ["ls-remote", "--quiet", src, "HEAD"], { ...env, GIT_TERMINAL_PROMPT: "0" });
        add("library", r.ok ? "ok" : "fail", r.ok ? `${team.library} reachable` : `can't reach ${team.library}: ${firstLine(r.out)}`);
    }
    const onPath = sh("sh", ["-c", "command -v otterpack"], env);
    add("otterpack on PATH", onPath.ok ? "ok" : "warn", onPath.ok ? `${onPath.out} (this shell's PATH; a VS Code task inherits the editor's)` : "otterpack is not on this shell's PATH; the VS Code tasks run `otterpack up` without a login shell, so check that a seat task starts");
    return checks;
}
