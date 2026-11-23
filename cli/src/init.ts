// otterpack init: write .otterpack/team.yaml from a library template.
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { parseDocument } from "yaml";
import { ConfigError, parseTeam, TEAM_FILE } from "./config.ts";
import { checkout, latestCommit, librarySource } from "./library.ts";
import { plan, LOCK_FILE } from "./sync.ts";

/** Never fold long lines: team.yaml is edited by hand, and a folded [a, b, c] is hard to edit. */
export const YAML_FORMAT = { lineWidth: 0, flowCollectionPadding: false } as const;

export const DEFAULT_LIBRARY = "https://github.com/soatdev-it/otterpack.git";
export const DEFAULT_TEMPLATE = "web-team";

export interface InitOptions {
  template?: string;
  library?: string;
  name?: string;
  home?: string;
}

export function init(root: string, opts: InitOptions = {}): string {
  const out = join(root, TEAM_FILE);
  if (existsSync(out)) throw new ConfigError(`${TEAM_FILE} already exists; edit it, or remove .otterpack/ to start over`);
  if (existsSync(join(root, LOCK_FILE))) {
    throw new ConfigError(`${LOCK_FILE} from an earlier team is still here; remove .otterpack/ (and the files it generated) to start over`);
  }
  const home = opts.home ?? homedir();
  const library = opts.library ?? process.env.OTTERPACK_LIBRARY ?? DEFAULT_LIBRARY;
  const template = opts.template ?? DEFAULT_TEMPLATE;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(template) || template.includes("..")) {
    throw new ConfigError(`template "${template}" may only use letters, digits, ., - and _`);
  }
  const source = librarySource(library, root);
  const lib = checkout(source, latestCommit(source, home), home);
  let result: string;
  try {
    const file = join(lib.path, "templates", `${template}.yaml`);
    if (!existsSync(file)) {
      const have = existsSync(join(lib.path, "templates"))
        ? readdirSync(join(lib.path, "templates")).filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5))
        : [];
      throw new ConfigError(`template "${template}" not found in the library (templates: ${have.join(", ") || "none"})`);
    }
    const doc = parseDocument(readFileSync(file, "utf8"));
    doc.set("name", opts.name ?? basename(root));
    doc.set("library", library);
    result = doc.toString(YAML_FORMAT);
    // Fail now, not at the first sync: the shape, and every kit and persona it names.
    plan(root, parseTeam(result, root), lib.path);
  } finally {
    lib.dispose();
  }
  mkdirSync(join(root, ".otterpack"), { recursive: true });
  writeFileSync(out, result);
  return out;
}
