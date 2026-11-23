# The otterpack library

What `otterpack sync` copies into a project, pinned by commit in each project's `.otterpack/lock.json`. To use your own, fork this repository or make one with the same `library/` layout, and point `library:` in `team.yaml` (or `otterpack init --library`) at it.

- `personas/<id>.md`: generic roles. A project adds its own rules in `.otterpack/local/personas/<id>.md` (read after the generic one), or keeps a project-only persona there.
- `kits/<id>/`: `skills/` and `agents/`. The folder is the kit. Its `README.md` holds one line about the kit, which `otterpack list` shows; sync doesn't copy it. A kit carries only skills and Claude agents: MCP servers, hooks and plugins stay project files.
- `templates/<id>.yaml`: team shapes for `otterpack init`.

Rule: something enters the library when two projects use it. Until then it stays in that project's `.otterpack/local/`.

## Where the kits come from

Most skills and agents are copied from MIT-licensed open-source projects: [everything-claude-code](https://github.com/affaan-m/ECC), [Matt Pocock's skills](https://github.com/mattpocock/skills), [OpenSEO](https://github.com/every-app/open-seo), [Leonxlnx's taste and imagegen skills](https://github.com/Leonxlnx/taste-skill) and [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Each third-party skill folder carries its `LICENSE.txt`, so the notice travels with it into every project. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists every item and its source. Something new added from another project needs a compatible license, and gets an entry there.

## What some skills need that a kit can't install

These skills stop or degrade without an outside tool. Set the tool up in the project (for example `claude mcp add …`), or take the kit out with `otterpack kit remove <kit>`.

| Kit | Skills | Needs |
|---|---|---|
| `seo` | all 10 OpenSEO skills (seo-audit, seo-report, seo-coach, seo-project-setup, keyword-research, keyword-clustering, competitor-analysis, competitive-landscape, link-prospecting, local-seo) | the OpenSEO MCP server. Each skill stops if it is not connected |
| `research` | documentation-lookup | the Context7 MCP server |
| `ux-design` | stitch-design-taste | Google Stitch |
| `ux-design` | web-interface-review | web access (it fetches the current guidelines before each review) |
| `ux-design` | image-to-code, imagegen-frontend-web, imagegen-frontend-mobile | an image generation tool; these skills make it their first step |
