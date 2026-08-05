/**
 * Job artifact store.
 *
 * Migration is a one-way operation over irreplaceable content, so an
 * unauditable run is worse than a slow one. Every stage writes a durable,
 * inspectable artifact; every artifact records the hash of its input, so a
 * resumed run can prove a stage's inputs are unchanged rather than assume it.
 *
 * Files are the source of truth. A database would be a convenience for
 * aggregate queries at this corpus size, not a requirement, so there is not one.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ArtifactMeta {
  /** Hash of the artifact's own content. */
  hash: string;
  /** Hash of the input that produced it, for the chain. */
  inputHash: string;
  stage: string;
  createdAt: string;
  engineVersion: string;
  profileId: string;
}

export interface JobManifest {
  jobId: string;
  sourceName: string;
  sourceHash: string;
  engineVersion: string;
  profileId: string;
  startedAt: string;
  finishedAt?: string;
  state: string;
  artifacts: Record<string, ArtifactMeta>;
  /** Aggregate counters worth having without re-reading every artifact. */
  summary?: Record<string, unknown>;
}

export const ENGINE_VERSION = "0.1.0";

export function hashOf(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Write-then-rename, so an interrupted run cannot leave a truncated artifact. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, data as never);
  await rename(temp, path);
}

export class JobStore {
  readonly root: string;
  readonly #manifest: JobManifest;

  private constructor(root: string, manifest: JobManifest) {
    this.root = root;
    this.#manifest = manifest;
  }

  static async open(workRoot: string, sourceName: string, sourceBytes: Uint8Array, profileId: string): Promise<JobStore> {
    const sourceHash = hashOf(sourceBytes);
    // The job id is derived from the content, so re-running the same file lands
    // in the same directory and a resume is possible without a registry.
    const jobId = `${safeName(sourceName)}-${sourceHash.slice(0, 12)}`;
    const root = join(workRoot, jobId);
    await mkdir(root, { recursive: true });

    let manifest: JobManifest;
    try {
      manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as JobManifest;
    } catch {
      manifest = {
        jobId,
        sourceName,
        sourceHash,
        engineVersion: ENGINE_VERSION,
        profileId,
        startedAt: new Date().toISOString(),
        state: "decoded",
        artifacts: {},
      };
    }

    const store = new JobStore(root, manifest);
    await store.put("00-source/original.bin", sourceBytes, "ingest", sourceHash);
    return store;
  }

  get manifest(): JobManifest {
    return this.#manifest;
  }

  /** Persist an artifact and record it in the manifest. */
  async put(relPath: string, data: string | Uint8Array, stage: string, inputHash: string): Promise<ArtifactMeta> {
    const path = join(this.root, relPath);
    await writeAtomic(path, data);
    const meta: ArtifactMeta = {
      hash: hashOf(data),
      inputHash,
      stage,
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      profileId: this.#manifest.profileId,
    };
    this.#manifest.artifacts[relPath] = meta;
    return meta;
  }

  async putJson(relPath: string, value: unknown, stage: string, inputHash: string): Promise<ArtifactMeta> {
    return this.put(relPath, `${JSON.stringify(value, null, 2)}\n`, stage, inputHash);
  }

  /**
   * Whether a stage can be skipped.
   *
   * Only when the artifact exists *and* was produced from the same input by the
   * same engine version. Anything weaker would silently serve a stale result
   * after a code change, which is the failure mode resumability usually has.
   */
  canReuse(relPath: string, inputHash: string): boolean {
    const meta = this.#manifest.artifacts[relPath];
    return (
      meta !== undefined &&
      meta.inputHash === inputHash &&
      meta.engineVersion === ENGINE_VERSION &&
      meta.profileId === this.#manifest.profileId
    );
  }

  async read(relPath: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, relPath), "utf8");
    } catch {
      return null;
    }
  }

  async finish(state: string, summary?: Record<string, unknown>): Promise<void> {
    this.#manifest.state = state;
    this.#manifest.finishedAt = new Date().toISOString();
    if (summary) this.#manifest.summary = summary;
    await writeAtomic(join(this.root, "manifest.json"), `${JSON.stringify(this.#manifest, null, 2)}\n`);
  }
}

function safeName(name: string): string {
  return name
    .replace(/\.[^.]+$/u, "")
    .replace(/[^\w.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .toLowerCase() || "page";
}
