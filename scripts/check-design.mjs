import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tokens = read("src/app/design-tokens.css");
const styles = read("src/app/globals.css");
const design = read("DESIGN.md").replaceAll("\r\n", "\n");
const previews = JSON.parse(read(".impeccable/design.json"));
const root = tokens.match(/:root\s*\{([^}]+)\}/s)?.[1];
assert(root, "Missing design token root");
const values = Object.fromEntries(
  [...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);
const palette = Object.fromEntries(
  [...design.matchAll(/^  ([\w-]+): "(#[a-f\d]{6})"$/gim)].map((match) => [
    `--${match[1]}`,
    match[2],
  ]),
);
assert(
  styles.includes('@import "./design-tokens.css";'),
  "Missing token import",
);
for (const [name, value] of Object.entries(values)) {
  if (/^#[a-f\d]{6}$/i.test(value))
    assert.equal(palette[name], value, `Color drift: ${name}`);
}
for (const [name, value] of Object.entries(palette))
  assert.equal(values[name], value, `Undocumented color: ${name}`);
for (const group of ["spacing", "rounded"]) {
  const section =
    design.match(new RegExp(`^${group}:\\n([\\s\\S]*?)(?=^\\S)`, "m"))?.[1] ??
    "";
  for (const [name, value] of Object.entries(values)) {
    const prefix = group === "spacing" ? "--space-" : "--radius-";
    if (name.startsWith(prefix)) {
      assert(
        section.includes(`  ${name.slice(prefix.length)}: ${value}`),
        `Document drift: ${name}`,
      );
    }
  }
}
for (const [name, value] of Object.entries(values)) {
  if (!name.startsWith("--type-")) continue;
  const role =
    name.slice("--type-".length) === "panel"
      ? "panel-label"
      : name.slice("--type-".length);
  const section =
    design.match(
      new RegExp(`^  ${role}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|^\\S)`, "m"),
    )?.[1] ?? "";
  const expected =
    role === "entry-headline"
      ? `clamp(${values["--type-headline-compact"]}, 3.3vw, ${value})`
      : value;
  assert(
    section.includes(`    fontSize: ${expected}`),
    `Typography drift: ${name}`,
  );
}
for (const [name, meta] of Object.entries(previews.extensions.colorMeta)) {
  assert.equal(
    values[`--${name}`],
    meta.canonical,
    `Color metadata drift: ${name}`,
  );
}
const defined = new Set(["--font-public-sans", ...Object.keys(values)]);
for (const match of styles.matchAll(/(--[\w-]+):/g)) defined.add(match[1]);
for (const css of [
  styles,
  ...previews.components.map((component) => component.css),
]) {
  for (const match of css.matchAll(/var\((--[\w-]+)/g))
    assert(defined.has(match[1]), `Undefined token: ${match[1]}`);
}
assert(
  !/#[a-f\d]{3,8}\b/i.test(styles),
  "Colors must be declared in design-tokens.css",
);
for (const component of previews.components) {
  assert(
    !/App Generator|generated\.app|New app/.test(component.html),
    `Stale component sample: ${component.name}`,
  );
}
for (const path of ["src/app/layout.tsx", "src/components/app-builder.tsx"]) {
  assert(
    !/data-impeccable|localhost:8400|impeccable-live/.test(read(path)),
    `Live tooling left in ${path}`,
  );
}
console.log(
  `Design verified: ${Object.keys(palette).length} color roles, ${Object.keys(values).length} tokens, ${previews.components.length} component samples.`,
);
