# Design

How otterpack works, and why it works that way. For how to use it, see the [README](../README.md).

## The problem

Each project needs its own team of coding agents. A marketing site needs copy and SEO seats. An API needs an architect and a reviewer. And a project's team changes as the project does: a role is added when a new need shows up, a seat is parked when its work is done, and the stack brings new skills.

Built by hand, a team is a launcher script per seat, a tmux layout, VS Code tasks, persona files, and copies of subagents and skills. That setup is costly to change, so it stops keeping up with the project. Each new project starts from a copy of the last one, and the copies drift: a fix to a persona means editing every repository. Each project carries skills it doesn't use. Codex and Claude each read their own skill folder, so a skill added to one folder is invisible to the other harness. And after a container rebuild, nobody remembers which conversation each seat was on.

otterpack makes a team cheap to set up and cheap to change, with two pieces:

- **A library:** personas, kits of skills and subagents, and team templates, in one git repository.
- **A CLI** that generates each project's files from that library, runs the seats, and changes the team (`add`, `remove`, `disable`, `kit add`) without losing a seat's conversation or notes.

## Pieces

```
library repository
└── library/
    ├── personas/<id>.md       roles
    ├── kits/<kit>/            skills/ and agents/; the folder is the kit
    └── templates/<id>.yaml    team shapes for init

each project
├── .otterpack/
│   ├── team.yaml              the seats and the project's kits (written by you)
│   ├── lock.json              the pinned library commit and the list of generated files
│   ├── local/                 project-only personas, addenda, kits, launchers, seat settings
│   ├── personas/              generated
│   ├── seats/<seat>/          each seat's notes and state files, committed
│   ├── state/                 gitignored: sessions/<seat>.json, the seat's conversation id
│   └── replaced/              gitignored: what sync --replace moved aside
└── generated and committed:   .claude/agents/  .claude/skills/  .agents/skills/  .vscode/tasks.json
```

The CLI is TypeScript on Node. The harnesses already need Node, so it is there in every container. The compiled `cli/dist/` is committed, so an install needs no build step.

## Sync

`sync` is a pure function of `team.yaml` and one library commit. It reads the library at the commit pinned in `lock.json`, through a bare mirror cached in `~/.otterpack/cache/`. It never reads the library's working tree, so two projects pinned to different commits don't affect each other. `update` is the only command that moves the pin.

What sync does:

- **It owns only what it wrote, or found exactly as it would write it.** `lock.json` lists every generated file with its hash.
  - A file in the way that isn't in the list is taken over when its bytes are exactly what sync writes. Typically it's a copy of the same library file. The output says how many files were taken over.
  - Any other file in the way, or a generated file edited by hand, stops sync before it writes anything. `--replace` moves such files to `.otterpack/replaced/<time>/`, and `--prune` also moves the hand-made agents and skills that no kit replaces.
  - Sync never deletes or overwrites content it didn't write: a file it took over held only the library's content.
- **It writes the kits once per project.** Every seat sees the same kits: the union listed in `kits:`. Scoping kits per seat would need per-seat config homes or launch flags. That cost isn't worth it until the shared set gets too large for the context.
- **It writes each skill twice.** Claude Code reads only `.claude/skills/`, and Codex reads only `.agents/skills/`. A skill in both is listed once by each. Copies are used rather than symlinks, so a checkout on any OS and any git setting sees the same files.
- **It writes subagents for Claude only.** Codex has no equivalent.
- **It checks whether the project is in sync** by hashing the *parsed* `team.yaml`. A comment or layout edit doesn't count as a change. `up` refuses to start or relaunch a seat from an out-of-sync `team.yaml`.

MCP servers, hooks, plugins and harness settings stay project files. They often hold machine-specific paths or secrets, and the harnesses already have their own formats for them.

## A seat's persona

On a seat's first launch, `up` passes one kickoff message as the harness's prompt argument:

```
[seat:my-site/claude-ar] You are Architect on this team. Read, in order:
1. .otterpack/personas/architect.md
2. docs/TEAM.md                                (the charter, if team.yaml names one)
3. .otterpack/local/personas/architect.md      (the project's addendum, if there is one)
Keep your notes and state files in your seat folder: .otterpack/seats/claude-ar/
```

The kickoff goes in the prompt argument, because typing it into a running TUI is unreliable. With `tmux send-keys`, trust or update dialogs catch the keys, and the Enter after a multi-line paste gets lost. No persona text is merged or compiled. The seat reads the files itself.

A seat with `persona: none` gets no kickoff. It is a plain harness session.

**The brief.** Each launch records the seat's brief in its session file: its persona id, and a hash of each file the kickoff lists. When a later launch resumes the conversation and the brief differs, the resume carries a re-brief as its prompt argument, the same way the kickoff is passed. The re-brief names what changed and lists the files to read again. The new brief is recorded with that launch, so each change is sent once. A running seat is never interrupted: `status`, `sync` and `update` name the seats waiting for a re-brief, and a restart delivers it. A session file from before briefs existed gets its brief recorded at the next launch, with no re-brief, since there is nothing to compare it with.

## Resume

Each seat's conversation id is kept in `.otterpack/state/sessions/<seat>.json`, one file per seat, written atomically. VS Code starts every seat's task at the same moment, and with one file per seat the launches never write the same file.

- **Claude:** `up` generates a UUID and launches with `--session-id`. Later launches use `--resume <id>`. Nothing has to be searched.
- **Codex** has no flag to set the session id. After the first launch, otterpack watches `~/.codex/sessions/` for the rollout file whose metadata has the seat's cwd and that contains the kickoff marker. The marker includes the project name, so two projects in the same folder path (`/workspace` in many devcontainers) can't be confused. Until the id is found, the seat is recorded as "not found yet".
- **A resume that fails stops with a message.** otterpack never silently starts a new conversation in place of the old one. `otterpack reset <seat>` is the explicit way to start afresh.

## Running seats in tmux

`up` keeps the seats alive across VS Code reloads, and brings them back after a restart.

- **One lock around setup.** It is a kernel `flock`, held by a child process, so it can't outlive a killed `up`, and a reused pid can't hold it. The tmux server never inherits it.
- **The launch is typed into a shell**, not run as the pane's command. When the harness exits, a shell is left, and the next `up` relaunches the harness on the same conversation. A seat whose harness is running is only attached, never restarted.
- **tmux-resurrect**, if installed, is restored once, when `up` starts the tmux server.
- **Each session `up` creates is marked** with the project root (`@otterpack_root`). `status`, `up`, `stop`, `reset` and `remove` act only on this project's sessions. A same-named session of another project is shown, but never attached to or killed.
- **Commands run from inside a seat** (`stop`, `reset`, `remove`) stop that seat last, and ignore the SIGHUP that its closing pane sends.
- **The tmux socket can be changed.** `TEAM_TMUX_SOCKET=<name>` runs a rehearsal on `tmux -L <name>`: each launch is typed as a no-op, and the server skips `~/.tmux.conf` and the resurrect restore. Tests use `OTTERPACK_TMUX_SOCKET=otterpack-test-*` with fake harnesses.

## VS Code

`.vscode/tasks.json` has one task per enabled seat, run on folder open. Each task runs `otterpack up <seat>` in a dedicated terminal, with the seat's label, icon and color. A last task, **Team: open all seats**, depends on all the others. VS Code matches tasks by label, so labels must be unique. VS Code runs folder-open tasks only once the user allows automatic tasks for the folder.

## Road to 1.0

1.0 means the interface (`team.yaml`, `lock.json`, the generated layout and the commands) is stable, and that otterpack does what it says: it gives each project the right team, and lets that team evolve. Done: a seat keeps up with its persona (see [The brief](#a-seats-persona)), `otterpack list` shows what the library offers, and there are two kinds of team (`web-team`, and `dev-team` for a codebase with no marketing site). Still missing:

- **Real use outside one machine:** installed from the release tarball by people other than the author, and tested on macOS.

## Not planned yet

Each of these waits until a real need for it shows up:

| Not planned | What would bring it in |
|---|---|
| Several teams in one project (for example a product team and a maintenance team) | A project whose seats split into groups that start, stop and evolve separately |
| A VS Code extension (seat tree, status bar) | The CLI and the generated tasks no longer give enough overview |
| Live seat status (working, idle, waiting for you) | Missing a seat that is waiting |
| Kits per seat | The shared set costs too much context |
| Kits that carry MCP servers, hooks or plugins | Two projects need the same one |
| Harnesses other than Claude Code and Codex | Someone actually runs one |
| Windows without WSL | tmux is the seat backend |
| A hosted version for people without a development setup (parked as a future exploration) | Developers use the CLI, and people who don't code ask to run a team. Each user would sign in with their own Claude or Codex account or API key: both vendors' terms forbid reselling or pooling plan usage |

The rules behind this list:

- Build on a trigger, not in anticipation.
- No abstraction before the second implementation: Claude, Codex and tmux are coded directly.
- Adding a field to `team.yaml` needs a case that the existing ones can't express.
