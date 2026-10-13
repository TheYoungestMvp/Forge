import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppGeneratorProvider,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  type ModelCallRecord,
} from "../src/lib/ai/provider";
import { readModelUsage } from "../src/lib/ai/telemetry";

const environmentKeys = [
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_API_KEY",
  "LLM_OUTPUT_MODE",
  "LLM_MAX_TOKENS_FIELD",
  "LLM_THINKING_MODE",
] as const;

async function withMockProvider(
  mockFetch: typeof fetch,
  run: () => Promise<void>,
  settings: Partial<Record<(typeof environmentKeys)[number], string>> = {},
) {
  const previous = environmentKeys.map((key) => process.env[key]);
  const previousFetch = globalThis.fetch;
  try {
    delete process.env.LLM_THINKING_MODE;
    Object.assign(process.env, {
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "https://example.invalid/private-endpoint",
      LLM_MODEL: "test-model",
      LLM_API_KEY: "private-api-key",
      LLM_OUTPUT_MODE: "json_schema",
      LLM_MAX_TOKENS_FIELD: "max_completion_tokens",
      ...settings,
    });
    globalThis.fetch = mockFetch;
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    environmentKeys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

const accounting = {
  prompt_tokens: 180,
  completion_tokens: 35,
  total_tokens: 215,
  prompt_tokens_details: { cached_tokens: 120 },
};
const mappedAccounting = {
  inputTokens: 180,
  outputTokens: 35,
  cachedInputTokens: 120,
  totalTokens: 215,
};
const unknownUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  totalTokens: null,
};

function completion(
  content = '{"title":"Test","html":"","css":"","javascript":""}',
  usage: unknown = accounting,
) {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content } }],
    ...(usage === undefined ? {} : { usage }),
  });
}

test("telemetry records plan, generation and repair with timing, accounting and settings", async () => {
  const calls: ModelCallRecord[] = [];
  let requests = 0;
  await withMockProvider(
    async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return requests === 1
        ? completion(
            '{"steps":["Create task controls","Implement task deletion"]}',
          )
        : completion();
    },
    async () => {
      const provider = createAppGeneratorProvider({
        onCall: (call) => calls.push(call),
      });
      const signal = new AbortController().signal;
      const plan = await provider.plan(
        { prompt: "private-task-prompt" },
        signal,
      );
      await provider.generate(
        { prompt: "private-task-prompt" },
        signal,
        undefined,
        plan,
      );
      await provider.generate(
        { prompt: "private-task-prompt" },
        signal,
        "private-repair-feedback",
        plan,
      );
    },
    {
      LLM_OUTPUT_MODE: "json_object",
      LLM_MAX_TOKENS_FIELD: "max_tokens",
      LLM_THINKING_MODE: "disabled",
    },
  );
  assert.equal(requests, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.phase),
    ["plan", "generate", "repair"],
  );
  calls.forEach((call, index) => {
    assert.equal(call.status, "success");
    assert.equal(call.errorCode, undefined);
    assert.equal(call.model, "test-model");
    assert(call.durationMs >= 5);
    assert.deepEqual(call.usage, mappedAccounting);
    assert.deepEqual(call.settings, {
      outputMode: "json_object",
      tokenField: "max_tokens",
      tokenBudget: index === 0 ? 1200 : 12000,
      thinkingMode: "disabled",
    });
    assert.deepEqual(Object.keys(call).sort(), [
      "durationMs",
      "model",
      "phase",
      "settings",
      "status",
      "usage",
    ]);
  });
  const serialized = JSON.stringify(calls);
  for (const secret of [
    "private-api-key",
    "private-endpoint",
    "private-task-prompt",
    "private-repair-feedback",
    "Create task controls",
  ]) {
    assert(!serialized.includes(secret), `telemetry leaked ${secret}`);
  }
  assert.equal(PROVIDER_PROTOCOL_VERSION, "chat-completions-json-v1");
  assert.equal(GENERATION_PROMPT_VERSION, "forge-app-v2-task-contract");
  assert.equal(PLANNING_PROMPT_VERSION, "forge-plan-v2-task-contract");
});

test("every provider failure emits exactly one sanitized error record", async (context) => {
  const failures: {
    name: string;
    fetch: typeof fetch;
    code: string;
    usage?: typeof mappedAccounting;
    plan?: boolean;
  }[] = [
    {
      name: "network failure",
      fetch: async () => {
        throw new Error("private-api-key private-endpoint");
      },
      code: "PROVIDER_UNREACHABLE",
    },
    ...[401, 403, 429, 500].map((status) => ({
      name: `HTTP ${status}`,
      fetch: async () => new Response("private-provider-body", { status }),
      code:
        status === 401 || status === 403
          ? "PROVIDER_AUTH_ERROR"
          : status === 429
            ? "PROVIDER_RATE_LIMIT"
            : "PROVIDER_REQUEST_FAILED",
    })),
    {
      name: "invalid JSON envelope",
      fetch: async () => new Response("not-json"),
      code: "INVALID_PROVIDER_RESPONSE",
    },
    {
      name: "refusal with billable usage",
      fetch: async () =>
        Response.json({
          choices: [{ message: { refusal: "private-refusal" } }],
          usage: accounting,
        }),
      code: "MODEL_REFUSED",
      usage: mappedAccounting,
    },
    {
      name: "truncation with billable usage",
      fetch: async () =>
        Response.json({
          choices: [
            { finish_reason: "length", message: { content: "partial" } },
          ],
          usage: accounting,
        }),
      code: "OUTPUT_TRUNCATED",
      usage: mappedAccounting,
    },
    {
      name: "empty content with billable usage",
      fetch: async () => completion(" "),
      code: "EMPTY_MODEL_OUTPUT",
      usage: mappedAccounting,
    },
    {
      name: "invalid plan with billable usage",
      fetch: async () => completion('{"steps":["only one"]}'),
      code: "INVALID_PLAN",
      usage: mappedAccounting,
      plan: true,
    },
    {
      name: "oversized response",
      fetch: async () => new Response("x".repeat(1024 * 1024 + 1)),
      code: "OUTPUT_TOO_LARGE",
    },
  ];
  for (const failure of failures) {
    await context.test(failure.name, async () => {
      const calls: ModelCallRecord[] = [];
      await withMockProvider(failure.fetch, async () => {
        const provider = createAppGeneratorProvider({
          onCall: (call) => calls.push(call),
        });
        const signal = new AbortController().signal;
        await assert.rejects(
          failure.plan
            ? provider.plan({ prompt: "private-task-prompt" }, signal)
            : provider.generate({ prompt: "private-task-prompt" }, signal),
          { code: failure.code },
        );
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].status, "error");
      assert.equal(calls[0].errorCode, failure.code);
      assert.equal(calls[0].phase, failure.plan ? "plan" : "generate");
      assert.deepEqual(calls[0].usage, failure.usage ?? unknownUsage);
      assert(calls[0].durationMs >= 0);
      assert(!JSON.stringify(calls).includes("private-"));
    });
  }
});

test("aborted fetch emits one error record and preserves the abort exception", async () => {
  const calls: ModelCallRecord[] = [];
  const controller = new AbortController();
  const abort = new DOMException("private-abort-details", "AbortError");
  await withMockProvider(
    async () => {
      controller.abort();
      throw abort;
    },
    async () => {
      const provider = createAppGeneratorProvider({
        onCall: (call) => calls.push(call),
      });
      await assert.rejects(
        provider.generate({ prompt: "request" }, controller.signal),
        (error) => error === abort,
      );
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "error");
  assert.equal(calls[0].errorCode, "REQUEST_ABORTED");
  assert.deepEqual(calls[0].usage, unknownUsage);
});

test("missing usage stays unknown and reported cache zero differs from missing cache", async () => {
  const calls: ModelCallRecord[] = [];
  const replies = [
    null,
    { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    {
      prompt_tokens: 10,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: 0 },
      prompt_cache_hit_tokens: 9,
    },
    {
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
      prompt_cache_hit_tokens: 8,
    },
  ];
  await withMockProvider(
    async () => completion("{}", replies.shift()),
    async () => {
      const provider = createAppGeneratorProvider({
        onCall: (call) => calls.push(call),
      });
      for (let index = 0; index < 4; index += 1) {
        await provider.generate(
          { prompt: "request" },
          new AbortController().signal,
        );
      }
    },
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].usage, unknownUsage);
  assert.deepEqual(calls[1].usage, {
    inputTokens: 10,
    outputTokens: 3,
    cachedInputTokens: null,
    totalTokens: 13,
  });
  assert.deepEqual(calls[2].usage, {
    inputTokens: 10,
    outputTokens: 3,
    cachedInputTokens: 0,
    totalTokens: null,
  });
  assert.deepEqual(calls[3].usage, {
    inputTokens: 10,
    outputTokens: 3,
    cachedInputTokens: 8,
    totalTokens: 13,
  });
  assert.equal(calls[0].settings.thinkingMode, null);
});

test("malformed usage is unknown rather than fabricated token counts", () => {
  assert.deepEqual(
    readModelUsage({
      usage: {
        prompt_tokens: "12",
        completion_tokens: -1,
        total_tokens: 2.5,
        prompt_tokens_details: { cached_tokens: Number.POSITIVE_INFINITY },
      },
    }),
    unknownUsage,
  );
  assert.deepEqual(
    readModelUsage({
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_cache_hit_tokens: 0,
      },
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 },
  );
});

test("throwing telemetry observers cannot replace either success or failure", async () => {
  await withMockProvider(
    async () => completion(),
    async () => {
      const provider = createAppGeneratorProvider({
        onCall: () => {
          throw new Error("observer error");
        },
      });
      assert.equal(
        typeof (await provider.generate(
          { prompt: "request" },
          new AbortController().signal,
        )),
        "string",
      );
      const asynchronousObserver = createAppGeneratorProvider({
        onCall: async () => {
          throw new Error("async observer error");
        },
      });
      await asynchronousObserver.generate(
        { prompt: "request" },
        new AbortController().signal,
      );
    },
  );
  await withMockProvider(
    async () => new Response("unauthorized", { status: 401 }),
    async () => {
      const provider = createAppGeneratorProvider({
        onCall: () => {
          throw new Error("observer error");
        },
      });
      await assert.rejects(
        provider.generate({ prompt: "request" }, new AbortController().signal),
        { code: "PROVIDER_AUTH_ERROR" },
      );
    },
  );
});

test("configuration errors never emit a call when no request was attempted", async () => {
  const calls: ModelCallRecord[] = [];
  let requests = 0;
  await withMockProvider(
    async () => {
      requests += 1;
      return completion();
    },
    async () => {
      assert.throws(
        () =>
          createAppGeneratorProvider({ onCall: (call) => calls.push(call) }),
        { code: "CONFIGURATION_ERROR" },
      );
    },
    { LLM_API_KEY: "" },
  );
  assert.equal(requests, 0);
  assert.deepEqual(calls, []);
});
