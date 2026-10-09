import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationError } from "../src/lib/generation/errors";
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

test("generation request accepts only a new prompt, never an editing baseline", () => {
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
    generateRequestSchema.safeParse({ prompt: "Change", app: valid }).success,
    false,
  );
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
