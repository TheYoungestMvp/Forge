import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationError } from "../src/lib/generation/errors";
import { createAppGeneratorProvider } from "../src/lib/ai/provider";
import { POST } from "../src/app/api/generate/route";
import { generateRequestSchema } from "../src/lib/generation/schema";
import { validateGeneratedApp } from "../src/lib/generation/validate";
import { composePreview } from "../src/lib/preview/compose";

const valid = {
  title: "Counter",
  html: '<main><button type="button">Increment</button><output>0</output></main>',
  css: "main { padding: 1rem; }",
  javascript:
    "let count=0; document.querySelector('button').addEventListener('click',()=>{ count++; document.querySelector('output').textContent=String(count); });",
};

test("accepts a self-contained interactive application", () => {
  assert.deepEqual(validateGeneratedApp(JSON.stringify(valid)), valid);
});

const cases = [
  ["outer code fence", "```json\n" + JSON.stringify(valid) + "\n```"],
  ["prose", "Here is your app: " + JSON.stringify(valid)],
  ["extra keys", JSON.stringify({ ...valid, explanation: "Hello" })],
  ["missing field", JSON.stringify({ ...valid, javascript: undefined })],
  ["wrong field type", JSON.stringify({ ...valid, html: 42 })],
  ["empty interaction", JSON.stringify({ ...valid, javascript: " " })],
  [
    "inner code fence",
    JSON.stringify({ ...valid, css: "```css\nmain{}\n```" }),
  ],
  [
    "full document",
    JSON.stringify({
      ...valid,
      html: "<!doctype html><html><body>App</body></html>",
    }),
  ],
  [
    "script element",
    JSON.stringify({ ...valid, html: "<script>alert(1)</script>" }),
  ],
  [
    "inline events",
    JSON.stringify({ ...valid, html: '<img onerror="alert(1)">' }),
  ],
  [
    "encoded javascript URL",
    JSON.stringify({
      ...valid,
      html: '<a href="&#x6a;avascript:alert(1)">Bad</a>',
    }),
  ],
  [
    "nested iframe",
    JSON.stringify({
      ...valid,
      html: '<iframe src="https://example.com"></iframe>',
    }),
  ],
  [
    "external asset",
    JSON.stringify({ ...valid, html: '<img src="https://example.com/a.png">' }),
  ],
  [
    "unsupported form",
    JSON.stringify({
      ...valid,
      html: "<form><input><button>Submit</button></form>",
    }),
  ],
  [
    "external stylesheet",
    JSON.stringify({
      ...valid,
      css: '@import "https://example.com/style.css";',
    }),
  ],
  [
    "syntax error",
    JSON.stringify({ ...valid, javascript: "const broken = ;" }),
  ],
  [
    "parent DOM",
    JSON.stringify({
      ...valid,
      javascript: "window.parent.document.body.textContent='bad';",
    }),
  ],
  [
    "computed parent DOM",
    JSON.stringify({
      ...valid,
      javascript: "window['parent'].document.body.textContent='bad';",
    }),
  ],
  [
    "browser storage",
    JSON.stringify({
      ...valid,
      javascript: "localStorage.setItem('task','1');",
    }),
  ],
  [
    "dynamic import",
    JSON.stringify({
      ...valid,
      javascript: "import('https://example.com/app.js');",
    }),
  ],
  [
    "UTF-8 field byte limit",
    JSON.stringify({ ...valid, css: "/*" + "🔥".repeat(20000) + "*/" }),
  ],
] as const;

for (const [name, raw] of cases) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => validateGeneratedApp(raw),
      (error) =>
        error instanceof GenerationError &&
        error.code === "INVALID_GENERATED_APP",
    );
  });
}

test("generation request accepts initial creation and a complete modification baseline", () => {
  assert.equal(
    generateRequestSchema.safeParse({ prompt: "Todo" }).success,
    true,
  );
  assert.equal(
    generateRequestSchema.safeParse({ prompt: "  " }).success,
    false,
  );
  assert.equal(
    generateRequestSchema.safeParse({ prompt: "x".repeat(4001) }).success,
    false,
  );
  assert.equal(
    generateRequestSchema.safeParse({ prompt: "Dark mode", currentApp: valid })
      .success,
    true,
  );
  assert.equal(
    generateRequestSchema.safeParse({
      prompt: "Change",
      currentApp: { html: "partial" },
    }).success,
    false,
  );
  assert.equal(
    generateRequestSchema.safeParse({
      prompt: "Change",
      currentApp: valid,
      history: [],
    }).success,
    false,
  );
});

test("modification API rejects unsafe, oversized or partial context before contacting a model", async () => {
  for (const [body, code, status] of [
    [
      {
        prompt: "Dark mode",
        currentApp: { ...valid, javascript: "parent.document.title='bad'" },
      },
      "INVALID_CURRENT_APP",
      400,
    ],
    [
      {
        prompt: "Dark mode",
        currentApp: { ...valid, css: "/*" + "🔥".repeat(20000) + "*/" },
      },
      "INVALID_CURRENT_APP",
      400,
    ],
    [
      { prompt: "Dark mode", currentApp: { html: "partial" } },
      "INVALID_REQUEST",
      400,
    ],
    [
      { prompt: "Dark mode", extra: "x".repeat(1024 * 1024) },
      "INVALID_REQUEST",
      413,
    ],
  ] as const) {
    const response = await POST(
      new Request("http://localhost:3000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("provider passes exact latest code as context and API returns complete validated replacements", async () => {
  const keys = [
    "LLM_PROVIDER",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_OUTPUT_MODE",
    "LLM_MAX_TOKENS_FIELD",
    "LLM_THINKING_MODE",
  ];
  const originalEnv = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  const outgoing: { messages: { role: string; content: string }[] }[] = [];
  const darkApp = { ...valid, css: "body{background:#111;color:#eee}" };
  const filteredApp = {
    ...darkApp,
    html: valid.html + '<button type="button">Unfinished</button>',
  };
  let reply = darkApp;
  try {
    Object.assign(process.env, {
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "http://localhost:4011/v1",
      LLM_MODEL: "test-model",
      LLM_API_KEY: "test-key",
      LLM_OUTPUT_MODE: "json_object",
      LLM_MAX_TOKENS_FIELD: "max_tokens",
      LLM_THINKING_MODE: "disabled",
    });
    globalThis.fetch = async (_url, options) => {
      outgoing.push(JSON.parse(String(options?.body)));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(reply) },
          },
        ],
      });
    };
    const provider = createAppGeneratorProvider();
    assert.deepEqual(
      validateGeneratedApp(
        await provider.generate(
          { prompt: "Change to dark mode", currentApp: valid },
          new AbortController().signal,
        ),
      ),
      darkApp,
    );
    assert.equal(outgoing[0].messages.length, 3);
    assert.equal(outgoing[0].messages[1].role, "assistant");
    assert.deepEqual(JSON.parse(outgoing[0].messages[1].content), valid);
    assert.match(
      outgoing[0].messages[0].content,
      /Preserve every existing feature/,
    );
    assert.match(outgoing[0].messages[0].content, /COMPLETE updated/);
    assert.equal(outgoing[0].messages[2].content, "Change to dark mode");

    reply = filteredApp;
    const response = await POST(
      new Request("http://localhost:3000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Add unfinished filter",
          currentApp: darkApp,
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events
        .filter((event) => event.type === "status")
        .map((event) => event.step),
      [0, 1, 2, 3],
    );
    assert.deepEqual(events.at(-1).app, filteredApp);
    assert.deepEqual(JSON.parse(outgoing[1].messages[1].content), darkApp);
    assert.equal(outgoing[1].messages[2].content, "Add unfinished filter");

    await provider.generate(
      { prompt: "New app" },
      new AbortController().signal,
    );
    assert.equal(outgoing[2].messages.length, 2);
    assert.equal(outgoing[2].messages[1].content, "New app");
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originalEnv[index] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[index];
    });
  }
});

test("preview wrapper escapes closing tags in code and title", () => {
  const app = {
    ...valid,
    title: "</script><img src=x>",
    javascript: 'const example = "</script><style>";',
  };
  const html = composePreview(app, "test-token");
  assert(!html.includes(app.title));
  assert(html.includes("\\u003c/script\\u003e"));
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert(html.includes("connect-src 'none'"));
  assert(html.includes("form-action 'none'"));
});
