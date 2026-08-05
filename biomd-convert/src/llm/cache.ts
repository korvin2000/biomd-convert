/**
 * The decision cache.
 *
 * Keyed on the full request — instructions, payload, schema and the *resolved*
 * model — so a re-run is free and byte-identical, and iteration on later stages
 * costs nothing. This is what makes `--replay` able to run the whole corpus
 * offline, and what lets a prompt change be diffed rather than guessed at.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CacheMeta {
  hook: string;
  version: string;
  model: string;
}

export interface DecisionCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, meta: CacheMeta): Promise<void>;
}

/** Non-persistent, for tests and dry runs. */
export class MemoryCache implements DecisionCache {
  readonly #map = new Map<string, unknown>();
  async get(key: string): Promise<unknown | undefined> {
    return this.#map.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.#map.set(key, value);
  }
  get size(): number {
    return this.#map.size;
  }
}

/**
 * Content-addressed cache on disk.
 *
 * One file per decision, sharded by the first two hex characters so a corpus
 * run does not produce a single directory with thousands of entries. Records
 * are committed alongside the golden corpus so CI is offline and free.
 */
export class FileCache implements DecisionCache {
  readonly #root: string;
  #hits = 0;
  #misses = 0;

  constructor(root: string) {
    this.#root = root;
  }

  #pathFor(key: string): string {
    return join(this.#root, key.slice(0, 2), `${key}.json`);
  }

  async get(key: string): Promise<unknown | undefined> {
    try {
      const raw = await readFile(this.#pathFor(key), "utf8");
      this.#hits += 1;
      return (JSON.parse(raw) as { value: unknown }).value;
    } catch {
      this.#misses += 1;
      return undefined;
    }
  }

  async set(key: string, value: unknown, meta: CacheMeta): Promise<void> {
    const file = this.#pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    const record = { key, meta, recordedAt: new Date().toISOString(), value };
    // Write-then-rename so an interrupted run cannot leave a truncated entry
    // that would later be read back as a valid decision.
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(temp, file);
  }

  stats(): { hits: number; misses: number; hitRate: number } {
    const total = this.#hits + this.#misses;
    return { hits: this.#hits, misses: this.#misses, hitRate: total === 0 ? 0 : this.#hits / total };
  }

  /** Remove every entry for one hook, so a prompt change can be re-run alone. */
  async invalidateHook(hookId: string): Promise<number> {
    let removed = 0;
    const { rm } = await import("node:fs/promises");
    let shards: string[];
    try {
      shards = await readdir(this.#root);
    } catch {
      return 0;
    }
    for (const shard of shards) {
      let files: string[];
      try {
        files = await readdir(join(this.#root, shard));
      } catch {
        continue;
      }
      for (const file of files) {
        const path = join(this.#root, shard, file);
        try {
          const record = JSON.parse(await readFile(path, "utf8")) as { meta?: CacheMeta };
          if (record.meta?.hook === hookId) {
            await rm(path);
            removed += 1;
          }
        } catch {
          /* skip unreadable entries */
        }
      }
    }
    return removed;
  }
}
