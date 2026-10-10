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
  function bindingNames(node: unknown, scope: Set<string>) {
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (item.type === "Identifier") scope.add(String(item.name));
    else if (item.type === "RestElement") bindingNames(item.argument, scope);
    else if (item.type === "AssignmentPattern") bindingNames(item.left, scope);
    else if (item.type === "ArrayPattern")
      (item.elements as unknown[]).forEach((child) =>
        bindingNames(child, scope),
      );
    else if (item.type === "ObjectPattern")
      (item.properties as Record<string, unknown>[]).forEach((child) =>
        bindingNames(
          child.type === "RestElement" ? child.argument : child.value,
          scope,
        ),
      );
  }
  function declarations(node: unknown, scope: Set<string>) {
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (item.type === "VariableDeclarator") bindingNames(item.id, scope);
    if (item.type === "FunctionDeclaration" || item.type === "ClassDeclaration")
      bindingNames(item.id, scope);
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "ClassDeclaration",
        "ClassExpression",
      ].includes(String(item.type))
    )
      return;
    for (const child of Object.values(item)) {
      if (Array.isArray(child))
        child.forEach((entry) => {
          if ((entry as Record<string, unknown>)?.type !== "BlockStatement")
            declarations(entry, scope);
        });
      else if (
        child &&
        typeof child === "object" &&
        (child as Record<string, unknown>).type !== "BlockStatement"
      )
        declarations(child, scope);
    }
  }
  function propertyName(item: Record<string, unknown>) {
    const property = item.property as Record<string, unknown>;
    return item.computed
      ? property?.type === "Literal"
        ? String(property.value)
        : null
      : property?.type === "Identifier"
        ? String(property.name)
        : null;
  }
  function hoistedVars(node: unknown, scope: Set<string>) {
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (
      String(item.type).includes("Function") ||
      String(item.type).startsWith("Class")
    )
      return;
    if (item.type === "VariableDeclaration" && item.kind === "var")
      (item.declarations as Record<string, unknown>[]).forEach((declaration) =>
        bindingNames(declaration.id, scope),
      );
    for (const child of Object.values(item)) {
      if (Array.isArray(child))
        child.forEach((entry) => hoistedVars(entry, scope));
      else if (child && typeof child === "object") hoistedVars(child, scope);
    }
  }
  function globalObject(node: unknown, scope: Set<string>): boolean {
    if (!node || typeof node !== "object") return false;
    const item = node as Record<string, unknown>;
    if (item.type === "Identifier")
      return (
        ["window", "self", "globalThis"].includes(String(item.name)) &&
        !scope.has(String(item.name))
      );
    if (item.type === "MemberExpression") {
      const object = item.object as Record<string, unknown>;
      if (
        propertyName(item) === "defaultView" &&
        object?.type === "Identifier" &&
        object.name === "document" &&
        !scope.has("document")
      )
        return true;
      return (
        ["window", "self", "globalThis"].includes(propertyName(item) || "") &&
        globalObject(item.object, scope)
      );
    }
    return false;
  }
  function inspectJs(
    node: unknown,
    inherited = new Set<string>(),
    parent?: Record<string, unknown>,
    key?: string,
  ) {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    let scope = inherited;
    if (
      [
        "Program",
        "BlockStatement",
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "CatchClause",
        "ClassDeclaration",
        "ClassExpression",
        "ForStatement",
        "ForOfStatement",
        "ForInStatement",
      ].includes(String(record.type))
    ) {
      scope = new Set(inherited);
      declarations(record, scope);
      if (record.type === "Program" || String(record.type).includes("Function"))
        hoistedVars(record.type === "Program" ? record : record.body, scope);
      if (String(record.type).startsWith("Class"))
        bindingNames(record.id, scope);
      if (String(record.type).includes("Function")) {
        bindingNames(record.id, scope);
        (record.params as unknown[]).forEach((param) =>
          bindingNames(param, scope),
        );
      }
      if (record.type === "CatchClause") bindingNames(record.param, scope);
    }
    if (record.type === "ImportExpression")
      invalid("JavaScript imports are not supported.");
    if (
      record.type === "Identifier" &&
      typeof record.name === "string" &&
      forbiddenGlobals.has(record.name) &&
      !scope.has(record.name) &&
      !(
        parent?.type === "MemberExpression" &&
        key === "property" &&
        !parent.computed
      ) &&
      !(
        ["Property", "MethodDefinition", "PropertyDefinition"].includes(
          String(parent?.type),
        ) &&
        key === "key" &&
        !parent?.computed &&
        !parent?.shorthand
      ) &&
      key !== "label"
    )
      invalid(
        `The generated code uses unsupported browser capability: ${record.name}.`,
      );
    if (
      record.type === "MemberExpression" &&
      forbiddenGlobals.has(propertyName(record) || "") &&
      globalObject(record.object, scope)
    )
      invalid(
        `The generated code references an unsupported browser capability: ${propertyName(record)}.`,
      );
    if (
      record.type === "MemberExpression" &&
      ["cookie", "location"].includes(propertyName(record) || "")
    ) {
      const object = record.object as Record<string, unknown>;
      if (
        (object?.type === "Identifier" &&
          object.name === "document" &&
          !scope.has("document")) ||
        (object?.type === "MemberExpression" &&
          propertyName(object) === "document" &&
          globalObject(object.object, scope))
      )
        invalid(
          `The generated code uses unsupported browser capability: document.${propertyName(record)}.`,
        );
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (Array.isArray(child))
        child.forEach((item) => inspectJs(item, scope, record, childKey));
      else if (child && typeof child === "object")
        inspectJs(child, scope, record, childKey);
    }
  }
  inspectJs(ast);
  return app;
}
