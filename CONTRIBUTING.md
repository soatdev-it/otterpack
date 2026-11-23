# Contributing

Thanks for helping. Bug reports, fixes, personas and kits are all welcome.

## Before you start

- **Bugs:** open an issue with the command you ran, its output, and `otterpack --version`, `tmux -V`, `node --version`. Run `otterpack doctor` and include its output if a seat doesn't start. Never paste credential files, tokens or conversation contents.
- **Security issues:** don't open a public issue. Report them privately through the repository's **Security → Report a vulnerability** page.
- **New features:** open an issue first. otterpack builds on a trigger, not in anticipation ([docs/design.md](docs/design.md#not-planned-yet)). Say what you are doing today, and why the existing commands and `team.yaml` fields don't cover it.

## Develop

Use the repository's devcontainer (Node 22, tmux, Claude Code and Codex), or any machine with Node 22.6 or later, git and tmux.

```bash
npm install
npm test            # unit and integration tests
npm run typecheck
npm run build       # compile cli/src to cli/dist
```

- **Test first.** Write the failing test, watch it fail, then make it pass. A bug fix comes with the test that would have caught it.
- **Tests never run real harnesses.** `cli/test/fake/` stands in for `claude` and `codex`, with a temporary `HOME`. A live session costs tokens and touches real conversations.
- **tmux tests use a private socket** (`OTTERPACK_TMUX_SOCKET=otterpack-test-…`), so they never touch your own sessions.
- **Commit `cli/dist/`** with the source change (`npm run build`). Projects install the committed build, and CI fails if it is stale.
- **Secrets by name only.** Code and tests print and store variable names, never their values, and never read credential files such as `~/.claude/.credentials.json` or `~/.codex/auth.json`.

## The library

- A persona is a role, not a project. Project names, paths and rosters belong in the project's `.otterpack/local/personas/<id>.md` addendum.
- Something enters the library when two projects use it.
- A skill or agent copied from another project needs a license that allows redistribution (MIT, Apache-2.0, BSD and similar). Put the upstream's `LICENSE.txt` in the skill folder, and add the item to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Without a license, it can't come in.
- If a skill needs an outside tool (an MCP server, an API), add it to the table in [library/README.md](library/README.md).

## Branches and releases

The project is trunk-based, with short-lived branches.

- **`main`** always passes CI. Nobody commits to it directly.
- **Branches:** `feat/<topic>`, `fix/<topic>` or `docs/<topic>`, each on one subject. Each commit is one green step, and its message says what changed and why.
- **Merging:** use a **merge commit**, not a squash or a rebase. Projects install otterpack at a pinned tag, and their `lock.json` pins a library commit, so pushed commits must keep their ids.
- **Releases:** an annotated tag `v<major>.<minor>.<patch>` on `main`. The version in `package.json`, `TAG` in `scripts/install-otterpack.sh` and the README's install commands all match the tag, and `CHANGELOG.md` has its entry. A tag never moves; a broken release gets a new tag.
- **Breaking changes:** `team.yaml`, `lock.json`, the generated file layout and the command line are the public interface. Before 1.0, a breaking change bumps the minor version, and its changelog entry says how to upgrade. From 1.0 on, it needs a major version.
