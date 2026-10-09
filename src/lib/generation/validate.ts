import "server-only";
import { parse } from "acorn";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { generatedAppSchema, type GeneratedApp } from "./schema";
import { GenerationError } from "./errors";

function invalid(message: string): never {
  throw new GenerationError("INVALID_GENERATED_APP", message);
}

const forbiddenTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
  "template",
]);
const forbiddenGlobals = new Set([
  "parent",
  "top",
  "frameElement",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "eval",
  "Function",
  "location",
]);

export function validateGeneratedApp(raw: string): GeneratedApp {
  if (raw.trim().startsWith("```"))
    invalid(
      "The model returned a Markdown code fence. Only a plain JSON object is accepted.",
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid("The model returned invalid JSON. Please retry generation.");
  }
  const result = generatedAppSchema.safeParse(value);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join(".") || "object"),
      ),
    ].join(", ");
    invalid(
      `The generated output did not match the required title/html/css/javascript schema (${fields}).`,
    );
  }
  const app = result.data;
  if (
    [app.title, app.html, app.css, app.javascript].some((field) =>
      /^\s*```/m.test(field),
    )
  ) {
    invalid(
      "Markdown code fences are not allowed in generated application fields.",
    );
  }
  const sizes = [app.html, app.css, app.javascript].map(
    (field) => new TextEncoder().encode(field).byteLength,
  );
  if (
    sizes.some((size) => size > 65536) ||
    sizes.reduce(
      (sum, size) => sum + size,
      new TextEncoder().encode(app.title).byteLength,
    ) > 131072
  )
    invalid(
      "The generated app is too large. Please request a smaller application.",
    );
  if (/<\/?(?:html|head|body)\b|<!doctype/i.test(app.html))
    invalid("HTML must be a body fragment, not a complete document.");
  if (/@import\b|url\s*\(/i.test(app.css))
    invalid(
      "The generated CSS depends on a resource URL. Request a self-contained application.",
    );

  const htmlErrors: string[] = [];
  const fragment = parseFragment(app.html, {
    onParseError: (error) => htmlErrors.push(error.code),
  });
  if (htmlErrors.length)
    invalid(
      "The generated HTML contains invalid markup. Please retry generation.",
    );
  function inspectHtml(node: DefaultTreeAdapterMap["node"]) {
    if ("tagName" in node) {
      if (forbiddenTags.has(node.tagName.toLowerCase()))
        invalid(
          `The generated HTML contains an unsupported <${node.tagName}> element.`,
        );
      for (const attr of node.attrs) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (
          name.startsWith("on") ||
          name === "srcdoc" ||
          name === "srcset" ||
          name === "action" ||
          name === "formaction"
        )
          invalid(
            "The generated HTML contains unsupported event handlers or external resources.",
          );
        if (name === "href" && !value.startsWith("#"))
          invalid(
            "Only page-local anchor links are supported in generated apps.",
          );
        if (
          name === "src" &&
          !(
            node.tagName === "img" &&
            /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)
          )
        )
          invalid(
            "Only embedded image data is supported; external resources are not allowed.",
          );
        if (name === "style" && /@import\b|url\s*\(/i.test(value))
          invalid("Inline styles must not load external resources.");
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(inspectHtml);
  }
  inspectHtml(fragment);

  let ast;
  try {
    ast = parse(app.javascript, {
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch {
    invalid(
      "The generated JavaScript has a syntax error. Please retry generation.",
    );
  }
  // This static check catches common unsupported APIs; the iframe enforces DOM isolation.
  function inspectJs(node: unknown) {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "ImportExpression")
      invalid("JavaScript imports are not supported.");
    if (
      record.type === "Identifier" &&
      typeof record.name === "string" &&
      forbiddenGlobals.has(record.name)
    )
      invalid(
        `The generated code uses unsupported browser capability: ${record.name}.`,
      );
    if (
      record.type === "Literal" &&
      typeof record.value === "string" &&
      forbiddenGlobals.has(record.value)
    )
      invalid(
        `The generated code references an unsupported browser capability: ${record.value}.`,
      );
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(inspectJs);
      else if (child && typeof child === "object") inspectJs(child);
    }
  }
  inspectJs(ast);
  return app;
}
