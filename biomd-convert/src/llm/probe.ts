/**
 * Transport conformance probe.
 *
 * Gateway feature claims are README self-descriptions. This turns the five
 * assumptions the pipeline actually relies on into checked facts, and it is
 * cheap enough to run whenever the gateway or its configuration changes.
 *
 * Finding a problem on five fixtures is considerably better than finding it
 * after a thousand-file run has filled a cache with results from an unknown
 * model.
 */
import { z } from "zod";
import { type ChatRequest, type Transport, TransportError } from "./transport.js";

export interface ProbeResult {
  id: string;
  title: string;
  /** Undefined when the probe could not run at all. */
  passed: boolean | undefined;
  detail: string;
  /** True when a failure only costs money, not correctness. */
  costOnly: boolean;
}

export interface ProbeReport {
  model: string;
  results: ProbeResult[];
  /** False when any correctness-relevant probe failed. */
  usable: boolean;
  summary: string;
}

const ECHO_SCHEMA = {
  name: "probe",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      echo: { type: "string", description: "Copy the token from the prompt verbatim." },
      count: { type: "integer", description: "Number of items described in the prompt." },
    },
    required: ["echo", "count"],
  },
};

const EchoReply = z.object({ echo: z.string(), count: z.number().int() });

/** A 2×1 PNG: left half red, right half blue. Distinguishable by any vision model. */
const TWO_TONE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFUlEQVR4nGP8z8Dwn4GBgYGJAQUAADk+AbYYQZ4bAAAAAElFTkSuQmCC";

export async function runTransportProbe(transport: Transport, model: string): Promise<ProbeReport> {
  const results: ProbeResult[] = [];

  const base: Omit<ChatRequest, "user"> = {
    model,
    system: "You are a conformance probe. Answer only through the provided tool, exactly as instructed.",
    schema: ECHO_SCHEMA,
    temperature: 0,
    maxOutputTokens: 256,
  };

  // 1 — structured output round-trip.
  const token = "ALPHA-7391-OMEGA";
  let firstUsage: { inputTokens: number; cachedInputTokens: number } | null = null;
  try {
    const reply = await transport.chat({
      ...base,
      user: `Echo this token exactly: ${token}. The prompt describes 3 items. Set count to 3.`,
    });
    const parsed = EchoReply.safeParse(reply.data);
    firstUsage = { inputTokens: reply.usage.inputTokens, cachedInputTokens: reply.usage.cachedInputTokens };
    results.push({
      id: "tool-use",
      title: "Structured output returns schema-valid JSON",
      passed: parsed.success && parsed.data.echo.includes(token),
      detail: parsed.success
        ? `echo=${JSON.stringify(parsed.data.echo)} count=${parsed.data.count}`
        : `schema violation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      costOnly: false,
    });
  } catch (error) {
    results.push({
      id: "tool-use",
      title: "Structured output returns schema-valid JSON",
      passed: false,
      detail: describe(error),
      costOnly: false,
    });
  }

  // 2 — vision. Only Tier-3 table adjudication needs it; without it the pipeline
  // falls back to text-only summaries, which is worse but not broken.
  //
  // The question must not be answerable from its own wording. An earlier
  // version named both colours and asked whether the model could see them,
  // which a text-only model answers correctly by reading the prompt — so the
  // probe passed on an endpoint that had dropped the image entirely.
  if (transport.sendsImages === false) {
    results.push({
      id: "vision",
      title: "Image input is accepted and reaches the model",
      passed: undefined,
      detail:
        "not tested: this transport is not sending images — the gateway declares no vision, or it " +
        "refused one earlier. Table adjudication uses text-only summaries.",
      costOnly: true,
    });
  } else
    try {
      const reply = await transport.chat({
        ...base,
        user:
          "An image is attached. It is two pixels: one red, one blue, side by side. " +
          'Set echo to "red-left" or "blue-left" for whichever colour is the left pixel, or to ' +
          '"cannot-see" if no image reached you. Set count to 2.',
        images: [{ data: Buffer.from(TWO_TONE_PNG, "base64"), mediaType: "image/png" }],
      });
      const parsed = EchoReply.safeParse(reply.data);
      // The fixture's left pixel is red. A model guessing from the text has
      // even odds, which is why this is reported as a capability check and not
      // as proof of a model's eyesight.
      results.push({
        id: "vision",
        title: "Image input is accepted and reaches the model",
        passed: parsed.success && parsed.data.echo.includes("red-left"),
        detail: parsed.success
          ? parsed.data.echo.includes("red-left")
            ? `echo=${JSON.stringify(parsed.data.echo)} — the left pixel was read correctly`
            : `echo=${JSON.stringify(parsed.data.echo)}; the left pixel is red`
          : "schema violation",
        costOnly: true,
      });
    } catch (error) {
      results.push({
        id: "vision",
        title: "Image input is accepted and reaches the model",
        passed: false,
        detail: `${describe(error)} — table adjudication will fall back to text-only summaries`,
        costOnly: true,
      });
    }

  // 3 — prompt caching. A second identical system prefix should report cache
  // reads. Purely a cost question.
  try {
    const longPrefix = `${base.system}\n${"Conformance padding. ".repeat(400)}`;
    await transport.chat({ ...base, system: longPrefix, user: `Echo ${token}. count=1.` });
    const second = await transport.chat({ ...base, system: longPrefix, user: `Echo ${token}. count=1.` });
    const cached = second.usage.cachedInputTokens;
    results.push({
      id: "prompt-cache",
      title: "Prompt caching is passed through and reported",
      passed: cached > 0,
      detail:
        cached > 0
          ? `${cached} cached input tokens reported on the second call`
          : "no cached tokens reported; the shared-prefix discount will not apply",
      costOnly: true,
    });
  } catch (error) {
    results.push({
      id: "prompt-cache",
      title: "Prompt caching is passed through and reported",
      passed: undefined,
      detail: `probe could not run: ${describe(error)}`,
      costOnly: true,
    });
  }

  // 4 — R1, transport transparency. A gateway that compresses prompts would
  // report materially fewer input tokens than the payload contains. The check
  // is deliberately loose: it is looking for compression, not for an exact
  // tokenizer match.
  if (firstUsage) {
    const payloadChars = base.system.length + 80;
    const floor = Math.floor(payloadChars / 8); // very generous lower bound
    const passed = firstUsage.inputTokens === 0 ? undefined : firstUsage.inputTokens >= floor;
    results.push({
      id: "transparency",
      title: "R1 — the request is not rewritten in flight",
      passed,
      detail:
        passed === undefined
          ? "gateway reported no usage; transparency could not be verified"
          : passed
            ? `${firstUsage.inputTokens} input tokens is consistent with the payload sent`
            : `${firstUsage.inputTokens} input tokens is far below the ~${floor} the payload implies — ` +
              "a compression engine is probably active. Disable it: it invalidates the decision cache " +
              "and makes replay non-reproducible.",
      costOnly: false,
    });
  }

  // 5 — R2, model identity. GatewayTransport throws when the resolved model
  // does not match, so reaching this point with results means it held.
  const identityHeld = results.some((r) => r.id === "tool-use" && r.passed === true);
  results.push({
    id: "model-identity",
    title: "R2 — the resolved model matches the requested one",
    passed: identityHeld ? true : undefined,
    detail: identityHeld
      ? `gateway resolved ${model} without substitution`
      : "not verified: no successful call to read a resolved model from",
    costOnly: false,
  });

  const blocking = results.filter((r) => !r.costOnly && r.passed === false);
  const usable = blocking.length === 0;
  const costIssues = results.filter((r) => r.costOnly && r.passed !== true);

  return {
    model,
    results,
    usable,
    summary: usable
      ? costIssues.length === 0
        ? "Gateway satisfies every requirement."
        : `Gateway is usable. ${costIssues.length} cost-only capability/ies unavailable: ` +
          `${costIssues.map((r) => r.id).join(", ")}. Correctness is unaffected; the spend estimate is not.`
      : `Gateway is NOT usable: ${blocking.map((r) => r.id).join(", ")} failed.`,
  };
}

function describe(error: unknown): string {
  if (error instanceof TransportError) return error.message;
  return (error as Error).message ?? String(error);
}
