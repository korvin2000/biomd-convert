/**
 * Hook discovery.
 *
 * There is no list of hook names anywhere in this program. A hook exists
 * because a directory exists:
 *
 *   src/llm/plugins/<name>/hook.ts        the definition
 *   src/llm/plugins/<name>/prompts/*.md   its prose
 *   src/llm/plugins/<name>/hook.test.ts   its contract
 *
 * The registry scans that directory, imports each `hook` module, checks the
 * definition, and refuses duplicates. Out-of-tree directories can be added
 * through `llm.hooks.paths`, so a candidate hook can live outside the
 * repository while it is being evaluated and be promoted by moving it in.
 *
 * Discovery is ordered by id and therefore deterministic (invariant 6): the
 * same checkout produces the same registry, and the same registry produces the
 * same requests.
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type HookDefinition, assertHookDefinition } from "./contract.js";

export interface DiscoveredHook {
  readonly hook: HookDefinition;
  /** Directory the hook was loaded from, for `biomd hooks show`. */
  readonly dir: string;
  /** True for the built-in `plugins/` tree, false for a configured path. */
  readonly builtin: boolean;
}

export class HookRegistry {
  readonly #byId = new Map<string, DiscoveredHook>();

  add(entry: DiscoveredHook): void {
    const existing = this.#byId.get(entry.hook.id);
    if (existing) {
      throw new Error(
        `Two plugins declare the hook id ${JSON.stringify(entry.hook.id)}:\n` +
          `  ${existing.dir}\n  ${entry.dir}\n` +
          "A hook id is the key configuration, the decision cache and the run report all use; " +
          "rename one of them.",
      );
    }
    this.#byId.set(entry.hook.id, entry);
  }

  get(id: string): DiscoveredHook | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** Every discovered hook, ordered by id. */
  all(): DiscoveredHook[] {
    return [...this.#byId.values()].sort((a, b) => a.hook.id.localeCompare(b.hook.id));
  }

  ids(): string[] {
    return this.all().map((e) => e.hook.id);
  }

  /** Hooks that run when the operator enables the LLM without naming any. */
  defaults(): string[] {
    return this.all()
      .filter((e) => e.hook.enabledByDefault)
      .map((e) => e.hook.id);
  }

  /** Which hooks serve a decision point, ordered by id. */
  forDecisionPoint(point: string): DiscoveredHook[] {
    return this.all().filter((e) => e.hook.decisionPoint === point);
  }
}

/** Where the built-in plugins live, relative to this module in `src/` or `dist/`. */
export function builtinPluginDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
}

export interface DiscoverOptions {
  /** Extra plugin directories, each containing one subdirectory per hook. */
  paths?: readonly string[];
  /** Skip the built-in tree. Only a test that wants an empty registry needs this. */
  builtin?: boolean;
}

export async function discoverHooks(options: DiscoverOptions = {}): Promise<HookRegistry> {
  const registry = new HookRegistry();
  const roots: Array<{ dir: string; builtin: boolean }> = [];
  if (options.builtin !== false) roots.push({ dir: builtinPluginDir(), builtin: true });
  for (const path of options.paths ?? []) roots.push({ dir: resolve(path), builtin: false });

  for (const root of roots) {
    let entries: string[];
    try {
      entries = (await readdir(root.dir)).sort();
    } catch (error) {
      if (root.builtin) continue; // an empty build tree is not an error
      throw new Error(`Hook path ${root.dir} cannot be read: ${(error as Error).message}`);
    }
    for (const name of entries) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const dir = join(root.dir, name);
      if (!(await isDirectory(dir))) continue;
      const module = await findHookModule(dir);
      if (!module) continue;
      const loaded = (await import(pathToFileURL(module).href)) as { hook?: unknown; default?: unknown };
      const definition = loaded.hook ?? loaded.default;
      assertHookDefinition(definition, module);
      registry.add({ hook: definition, dir, builtin: root.builtin });
    }
  }

  return registry;
}

/**
 * Prefer the compiled module.
 *
 * Under vitest this directory holds `hook.ts`; after `tsc` it holds `hook.js`.
 * Checking `.js` first matters when both are present — a stale `src/` beside a
 * fresh `dist/` is a normal state during a build, and importing the TypeScript
 * from a Node process without a loader simply fails.
 */
async function findHookModule(dir: string): Promise<string | null> {
  for (const candidate of ["hook.js", "hook.ts"]) {
    const path = join(dir, candidate);
    try {
      const info = await stat(path);
      if (info.isFile()) return path;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
