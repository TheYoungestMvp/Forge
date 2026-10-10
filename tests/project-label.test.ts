import assert from "node:assert/strict";
import { test } from "node:test";
import { projectLabel } from "../src/lib/projects/label";

test("existing unnamed projects can be distinguished without renaming saved records", () => {
  const first = {
    name: "Untitled project",
    created_at: "2026-10-10T07:00:00Z",
  };
  const second = { ...first, created_at: "2026-10-10T07:00:15Z" };
  assert.notEqual(projectLabel(first), projectLabel(second));
  assert.equal(first.name, "Untitled project");
  assert.match(projectLabel(first), /2026/);
});

test("user-defined project names are preserved verbatim", () => {
  const project = {
    name: "我的实验 · 2026",
    created_at: "2026-10-10T07:00:00Z",
  };
  assert.equal(projectLabel(project), project.name);
});

test("unavailable creation dates do not prevent opening a legacy project", () => {
  assert.equal(
    projectLabel({ name: "Untitled project", created_at: "unavailable" }),
    "Untitled project",
  );
});
