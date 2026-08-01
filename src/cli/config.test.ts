import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  findProjectConfig,
  loadConfig,
  loadDotEnv,
  normalizeBaseUrl,
  redactKey,
  resolveGateway,
  stripJsonComments,
} from "./config.js";

let dir: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "biomd-cfg-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("BIOMD_") || key.startsWith("OPENROUTER_")) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

async function writeConfig(body: string, name = "biomd.config.json"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  return path;
}

describe("normalizeBaseUrl", () => {
  it("strips a pasted endpoint down to the API base", () => {
    // The single most likely configuration mistake.
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1/chat/completions")).toEqual({
      url: "https://openrouter.ai/api/v1",
      changed: true,
    });
  });

  it("leaves a correct base alone", () => {
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1")).toEqual({
      url: "https://openrouter.ai/api/v1",
      changed: false,
    });
  });

  it("trims a trailing slash", () => {
    expect(normalizeBaseUrl("http://localhost:4000/v1/").url).toBe("http://localhost:4000/v1");
  });

  it("handles the Anthropic-native passthrough path too", () => {
    expect(normalizeBaseUrl("http://localhost:4000/v1/messages").url).toBe("http://localhost:4000/v1");
  });
});

describe("stripJsonComments", () => {
  it("removes line and block comments but keeps strings intact", () => {
    const input = `{
      // a line comment
      "url": "https://x/api/v1", /* inline */
      "note": "not // a comment, and not /* one either */"
    }`;
    const parsed = JSON.parse(stripJsonComments(input)) as Record<string, string>;
    expect(parsed["url"]).toBe("https://x/api/v1");
    expect(parsed["note"]).toBe("not // a comment, and not /* one either */");
  });

  it("does not choke on an escaped quote inside a string", () => {
    const parsed = JSON.parse(stripJsonComments('{"a":"say \\"hi\\" // ok"}')) as Record<string, string>;
    expect(parsed["a"]).toBe('say "hi" // ok');
  });
});

describe("loadDotEnv", () => {
  it("reads keys, ignores comments, strips quotes", async () => {
    const path = join(dir, ".env");
    await writeFile(path, '# comment\nA=1\nB="two"\nC=\'three\'\n\nBAD_LINE\n', "utf8");
    expect(loadDotEnv(path)).toEqual({ A: "1", B: "two", C: "three" });
  });

  it("returns nothing for a missing file", () => {
    expect(loadDotEnv(join(dir, "nope"))).toEqual({});
  });
});

describe("loadConfig precedence", () => {
  it("applies defaults when nothing is configured", () => {
    const { config } = loadConfig({ cwd: dir });
    expect(config.profile).toBe("renderer-current");
    expect(config.layoutFidelity).toBe("simplified");
    expect(config.llm.enabled).toBe(false);
  });

  it("reads a project config and records provenance for nested keys", async () => {
    const path = await writeConfig('{ "profile": "spec-1.6", "llm": { "enabled": true } }');
    const { config, sources } = loadConfig({ configPath: path, cwd: dir });
    expect(config.profile).toBe("spec-1.6");
    expect(sources["profile"]).toBe("project-config");
    // Nested keys must report their own source, not fall back to "default" —
    // this is the question `config show` exists to answer.
    expect(sources["llm.enabled"]).toBe("project-config");
  });

  it("lets a flag override the file", async () => {
    const path = await writeConfig('{ "visual": "always" }');
    const { config, sources } = loadConfig({ configPath: path, cwd: dir, flags: { visual: "never" } });
    expect(config.visual).toBe("never");
    expect(sources["visual"]).toBe("flag");
  });

  it("lets an environment variable override the file but not a flag", async () => {
    const path = await writeConfig('{ "visual": "always" }');
    process.env["BIOMD_VISUAL"] = "auto";
    expect(loadConfig({ configPath: path, cwd: dir }).config.visual).toBe("auto");
    expect(loadConfig({ configPath: path, cwd: dir, flags: { visual: "never" } }).config.visual).toBe("never");
  });

  it("defines an implicit gateway from environment variables alone", () => {
    process.env["BIOMD_GATEWAY_URL"] = "https://openrouter.ai/api/v1/chat/completions";
    process.env["BIOMD_GATEWAY_KEY"] = "sk-or-test";
    process.env["BIOMD_MODEL"] = "deepseek/deepseek-v4-flash";

    const { config } = loadConfig({ cwd: dir });
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.gateway).toBe("env");

    const gateway = resolveGateway(config);
    // The pasted endpoint is normalized on the way in.
    expect(gateway.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(gateway.models.fast).toBe("deepseek/deepseek-v4-flash");
    expect(gateway.apiKey).toBe("sk-or-test");
    // Provenance must name the variable, not claim the key came from a file.
    expect(gateway.apiKeySource).toBe("environment (BIOMD_GATEWAY_KEY)");
  });

  it("normalizes a pasted endpoint in a config file and warns", async () => {
    const path = await writeConfig(
      '{ "llm": { "gateways": { "or": { "baseUrl": "https://openrouter.ai/api/v1/chat/completions", "models": { "fast": "m" } } } } }',
    );
    const { config, warnings } = loadConfig({ configPath: path, cwd: dir });
    expect(config.llm.gateways["or"]?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnings.join(" ")).toMatch(/should be the API base/u);
  });

  it("reports an invalid config with the offending path", async () => {
    const path = await writeConfig('{ "jobs": -4 }');
    expect(() => loadConfig({ configPath: path, cwd: dir })).toThrow(/jobs/u);
  });

  it("warns when the selected gateway does not exist", async () => {
    const path = await writeConfig('{ "llm": { "enabled": true, "gateway": "missing" } }');
    expect(loadConfig({ configPath: path, cwd: dir }).warnings.join(" ")).toMatch(/no such entry/u);
  });

  it("finds a project config by searching upward", async () => {
    await writeConfig('{ "profile": "spec-1.6" }');
    const nested = join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    expect(findProjectConfig(nested)).toBe(join(dir, "biomd.config.json"));
  });
});

describe("resolveGateway", () => {
  const base = (extra: string) =>
    `{ "llm": { "gateway": "gw", "gateways": { "gw": { "baseUrl": "http://x/v1"${extra} } } } }`;

  it("resolves a key from the named environment variable", async () => {
    process.env["MY_KEY"] = "sk-from-env";
    const path = await writeConfig(base(', "apiKeyEnv": "MY_KEY", "models": { "fast": "m" }'));
    const gateway = resolveGateway(loadConfig({ configPath: path, cwd: dir }).config);
    expect(gateway.apiKey).toBe("sk-from-env");
    expect(gateway.apiKeySource).toBe("environment (MY_KEY)");
  });

  it("falls every tier back to the one model that is defined", async () => {
    const path = await writeConfig(base(', "models": { "fast": "only-one" }'));
    const gateway = resolveGateway(loadConfig({ configPath: path, cwd: dir }).config);
    expect(gateway.models).toEqual({ fast: "only-one", balanced: "only-one", deep: "only-one" });
  });

  it("explains itself when no gateway is selected", () => {
    expect(() => resolveGateway(loadConfig({ cwd: dir }).config)).toThrow(ConfigError);
    try {
      resolveGateway(loadConfig({ cwd: dir }).config);
    } catch (error) {
      // An error message that does not say what to do next is a bug report
      // waiting to happen.
      expect((error as Error).message).toMatch(/biomd config init/u);
    }
  });

  it("explains itself when a gateway defines no models", async () => {
    const path = await writeConfig(base(""));
    expect(() => resolveGateway(loadConfig({ configPath: path, cwd: dir }).config)).toThrow(/no models/u);
  });

  it("defaults structuredOutput to tools and identity enforcement to on", async () => {
    const path = await writeConfig(base(', "models": { "fast": "m" }'));
    const gateway = resolveGateway(loadConfig({ configPath: path, cwd: dir }).config);
    expect(gateway.structuredOutput).toBe("tools");
    expect(gateway.enforceModelIdentity).toBe(true);
  });
});

describe("redactKey", () => {
  it("shows enough to identify a key and no more", () => {
    const redacted = redactKey("sk-or-v1-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toContain("sk-or-v1");
    expect(redacted).not.toContain("mnopqrst");
  });

  it("does not leak a short key", () => {
    expect(redactKey("short")).toBe("sho…");
  });

  it("says so when there is no key", () => {
    expect(redactKey(undefined)).toBe("(not set)");
  });
});
