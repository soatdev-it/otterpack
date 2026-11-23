# Changelog

All notable changes to otterpack. Versions follow [Semantic Versioning](https://semver.org/). Until 1.0, a minor version may change `team.yaml`, `lock.json` or the commands; its entry then says how to upgrade.

## 0.6.2 — 2026-11-23

### Fixed

- Seats opened at the same time (a VS Code reload) no longer wait for each other's login shells. `up` held its setup lock until each seat's launch was running, up to 5 s per seat, so the last of several seats could time out after 60 s. Six seats with a 4 s login shell took 25 s to set up; now they take 1 s.
- A seat's second `up` no longer types the launch again when the first one's shell is slow to run it. The line could land in the harness's input as a prompt. `up` now marks the seat as starting when it types the launch, and the launch clears the mark when it runs. Meanwhile another `up` attaches, and `status` shows the seat as starting.

## 0.6.1 — 2026-11-23

### Fixed

- `up` timing out on its setup lock printed a stack trace. It is now a one-line error that names the holder: its pid, its command and project, and how long it has held the lock. The message then says how to stop the holder if it is stuck.

## 0.6.0 — 2026-11-23

### Changed

- sync takes over a file that is already there with exactly the content it would write, typically a copy of the same library file, instead of stopping on it. The output gives the number of files taken over. From then on they are generated files: `update` changes them, and removing their kit removes them. Only files whose content differs still stop sync. Adding otterpack to a project that already has some of the library's skills and agents then stops only on those that really differ.

## 0.5.0 — 2026-11-23

### Removed

- `otterpack migrate`, which 0.4.0 had for projects set up before the first public release, and the code that recognized those projects and their tmux sessions. No public install needs it.

## 0.4.0 — 2026-11-23

First public release.

- **A team per project**, in `.otterpack/team.yaml`. Each seat is a Claude Code or Codex session with its own persona, in its own tmux session and VS Code terminal.
- **Start from a template** (`init`, with `web-team` or `dev-team`), then shape the team as the project changes: `add`, `remove`, `disable`, `enable`, `kit add|remove`.
- **Run the seats** with `up`, `stop`, `reset` and `status`. After a window reload, a container restart or a rebuild, each seat resumes its own conversation. When its persona, charter or addendum changes, its next start carries a short re-brief.
- **A shared library, pinned per project** in `.otterpack/lock.json`. `sync` writes its personas, skills and Claude subagents into the project, with each skill visible to both Claude Code and Codex. `update` moves the pin to the library's latest commit.
- `list` shows the library's templates, personas and kits. `doctor` checks tmux, the harness CLIs, logins and persistence.
- The library has 9 personas, 7 kits (42 skills, 13 subagents) and 2 templates. Third-party skills keep their licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
