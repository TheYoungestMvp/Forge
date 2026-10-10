import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceStatus } from "../src/lib/preview/status";

const ready = {
  generating: false,
  restoring: false,
  generationError: null,
  previewError: null,
  hasPreview: true,
  previewReady: true,
};

test("a saved application is not ready until its preview actually runs", () => {
  const status = workspaceStatus({ ...ready, previewReady: false });
  assert.equal(status.label, "Loading");
  assert.doesNotMatch(status.announcement, /application ready/i);
  assert.equal(workspaceStatus(ready).label, "Ready");
});

test("a runtime failure overrides an existing successful preview", () => {
  const failed = workspaceStatus({ ...ready, previewError: "Runtime failure" });
  assert.equal(failed.tone, "error");
  assert.equal(failed.label, "Preview error");
  assert.match(failed.announcement, /Open Preview/);
  assert.doesNotMatch(failed.heading, /ready/i);
  assert.equal(workspaceStatus(ready).label, "Ready");
});

test("an update or restore has a working status while an old preview is broken", () => {
  const broken = { ...ready, previewReady: false, previewError: "Old failure" };
  assert.equal(
    workspaceStatus({ ...broken, generating: true }).label,
    "Working",
  );
  assert.equal(
    workspaceStatus({ ...broken, restoring: true }).label,
    "Restoring",
  );
});

test("a failed generation remains distinct from a previous runtime failure", () => {
  const status = workspaceStatus({
    ...ready,
    generationError: "Generation failed",
    previewError: "Old failure",
  });
  assert.equal(status.label, "Error");
  assert.equal(status.heading, "Generation failed");
});
