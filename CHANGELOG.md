# Changelog

All notable changes to otterpack, called agentteam up to 0.3. Versions follow [Semantic Versioning](https://semver.org/). Until 1.0, a minor version may change `team.yaml`, `lock.json` or the commands; its entry then says how to upgrade.

## 0.4.0 — 2026-11-23

agentteam is now **otterpack**: the package, the command, the project folder and the repository.

### Upgrade from agentteam 0.3

1. Install otterpack in place of agentteam:
   ```bash
   npm uninstall -g agentteam
   npm install -g https://github.com/soatdev-it/otterpack/archive/refs/tags/v0.4.0.tar.gz
   ```
   In a devcontainer, replace `.devcontainer/install-agentteam.sh` with [`scripts/install-otterpack.sh`](scripts/install-otterpack.sh), and update the `postCreateCommand` and `postAttachCommand` that run it.
2. In each project, from a terminal outside the seats, run `otterpack migrate`. It stops the project's running seats (their conversations are kept), renames `.agentteam/` to `.otterpack/`, points `lock.json` at the new paths, and syncs, which rewrites the VS Code tasks to run `otterpack`.
3. Commit the move, then reload the VS Code window. Each seat resumes its conversation with a one-time re-brief that says its files moved to `.otterpack/`.

Until a project is migrated, otterpack's other commands stop there and say to run `otterpack migrate`.

Also renamed:
- The environment variables `AGENTTEAM_LIBRARY`, `AGENTTEAM_TMUX_SOCKET`, `AGENTTEAM_DEBUG`, `AGENTTEAM_REPO` and `AGENTTEAM_TAG` are now `OTTERPACK_*`. The old names are no longer read.
- The library cache moved from `~/.agentteam/cache` to `~/.otterpack/cache`. The old folder can be deleted, and a devcontainer volume on `~/.agentteam` can point at `~/.otterpack`.
- The library's default URL is now `https://github.com/soatdev-it/otterpack.git`. A `team.yaml` whose `library:` names another repository keeps it. To switch to this one, change `library:`, then run `otterpack update`: sync stops until the pin is moved to a commit of the new library.

Seats started by agentteam that are still running are recognized as the project's own: their old tmux mark (`@agentteam_root`) counts.

### Added

- `otterpack migrate`, described above.
- The otter mascot in the README.

## 0.3.0 — 2026-11-23

### Added

- Re-briefs. Each launch records what a seat was told to read: its persona, charter and addendum. When that changes (another persona, an edited persona file, or a new one from `agentteam update`), the seat's next resume carries a short re-brief as its prompt. `status`, `sync` and `update` name the seats still waiting for one. Seats running before this version start being tracked at their next launch.

- `agentteam list [--library <src>]`: the templates, personas and kits in the library, each with one line about it. Inside a project, it reads the pinned commit, adds the project's local personas and kits, and marks what the team uses.
- A one-line `README.md` in each library kit, which `list` shows.
- The `dev-team` template, for a codebase with no marketing site: architect, developer, code reviewer and QA, with the lead owning the backlog.
- Three personas: `developer` (any stack), `code-reviewer` and `qa`.

### Changed

- A seat's session file (`.agentteam/state/sessions/<seat>.json`) also records its `brief`. A launcher script now also gets the re-brief as its last argument when it resumes.

## 0.2.0 — 2026-11-23

First release prepared for open source. A `v1.0.0` tag of the same code was pushed on 2026-11-22 and withdrawn the next day: the product isn't at 1.0 yet (see the [road to 1.0](docs/design.md#road-to-10)).

### Added

- `LICENSE` (MIT) and `THIRD_PARTY_NOTICES.md`. Each third-party skill in the library now carries its `LICENSE.txt`, which sync copies into the project with the skill.
- The `web-interface-review` skill (ux-design kit), written for agentteam.
- `AGENTTEAM_REPO` and `AGENTTEAM_TAG` overrides in `scripts/install-agentteam.sh`, for forks.
- A CI workflow: typecheck, check that `cli/dist` matches the source, tests.
- `docs/design.md`: how sync, kickoff, resume and the tmux seats work.

### Changed

- The library personas say "the lead" (the human who runs the team) instead of "the founder".
- agentteam is positioned as the right team for each project, evolving with it, rather than one team setup reused everywhere.
- The README is rewritten for new users: install from a release tarball, quick start, a `team.yaml` reference, troubleshooting.

### Removed

- `agentteam import-sessions`, a one-off migration from an earlier script-based setup. Seats already running under agentteam are not affected.
- The `web-design-guidelines` skill (ux-design kit). Its upstream has no license file, so it can't be redistributed; use `web-interface-review` instead. The next `agentteam update` removes the old copy from your project, unless it was edited.

## 0.1.0-beta.5

- `sync --replace [--prune]` (also on `init`): moves hand-made files in the way to `.agentteam/replaced/<time>/` instead of stopping.
- `kit add` and `kit remove`.
- `team.yaml` lists are never folded across lines.

## 0.1.0-beta.4

- `scripts/install-agentteam.sh` for devcontainers: never fails a rebuild, skips when the version is already installed.
- `agentteam --version`.

## 0.1.0-beta.3

- `disable` and `enable`: keep a seat in `team.yaml` without starting it.

## 0.1.0-beta.2

- `status`, `stop`, `reset`, `add` and `remove`.
- A folder per seat (`.agentteam/seats/<seat>/`), named in the kickoff.
- Only this project's tmux sessions are touched; a same-named session of another project is left alone.
- `up` refuses to start seats from a `team.yaml` that hasn't been synced.

## 0.1.0-beta.1

- `init`, `sync`, `update`, `up` and `doctor`.
- Resume on the same conversation for Claude Code (`--session-id`) and Codex (kickoff marker).
- The first library: six personas, seven kits and the six-seat `web-team` template.
