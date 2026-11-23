# Changelog

All notable changes to otterpack. Versions follow [Semantic Versioning](https://semver.org/). Until 1.0, a minor version may change `team.yaml`, `lock.json` or the commands; its entry then says how to upgrade.

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
