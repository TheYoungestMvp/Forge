import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalTask,
  resolveTaskSpec,
  TASK_CONTRACT_VERSION,
  taskSpecSchema,
  type TaskSpec,
} from "../src/lib/generation/task";

function task(overrides: Record<string, unknown> = {}) {
  return {
    version: "1",
    goal: "Create a reading tracker",
    requirements: ["Add and remove books"],
    data: [
      {
        name: "books",
        fields: [
          { name: "title", type: "text", required: true },
          {
            name: "status",
            type: "enum",
            required: true,
            options: ["unread", "read"],
          },
        ],
      },
    ],
    preserve: ["Keep saved books"],
    acceptance: [
      {
        id: "add_book",
        name: "Add a book",
        action: "Submit a title",
        expected: "The title appears in the list",
        kind: "behavior",
      },
    ],
    ...overrides,
  };
}

test("task contract parses explicit inputs and normalizes descriptive text", () => {
  const parsed = taskSpecSchema.parse(
    task({ goal: "  Create a reading tracker  " }),
  );
  assert.equal(parsed.version, TASK_CONTRACT_VERSION);
  assert.equal(parsed.goal, "Create a reading tracker");
  assert.equal(parsed.data[0].fields[1].type, "enum");
  assert.equal(parsed.acceptance[0].kind, "behavior");
  assert(taskSpecSchema.safeParse(task({ data: [], acceptance: [] })).success);
  assert(
    taskSpecSchema.safeParse(
      task({ requirements: [], data: [], preserve: [], acceptance: [] }),
    ).success,
  );
});

test("task rejects missing arrays, malformed versions, and unknown authority", () => {
  for (const key of ["requirements", "data", "preserve", "acceptance"]) {
    const input = task();
    delete input[key as keyof typeof input];
    assert.equal(taskSpecSchema.safeParse(input).success, false, key);
  }
  for (const version of [undefined, 1, "2", "", " 1 "]) {
    assert.equal(taskSpecSchema.safeParse(task({ version })).success, false);
  }
  for (const key of [
    "owner",
    "ownerId",
    "project",
    "projectId",
    "capabilities",
    "permissions",
    "budget",
    "tools",
    "other",
  ]) {
    assert.equal(
      taskSpecSchema.safeParse(task({ [key]: "untrusted" })).success,
      false,
      key,
    );
  }
  assert.equal(
    taskSpecSchema.safeParse(
      task({ data: [{ name: "books", fields: [], tools: [] }] }),
    ).success,
    false,
  );
  assert.equal(
    taskSpecSchema.safeParse(
      task({ acceptance: [{ ...task().acceptance[0], verified: true }] }),
    ).success,
    false,
  );
});

test("task validates field types, identifiers, required flags, and enum options", () => {
  function parseField(field: Record<string, unknown>) {
    return taskSpecSchema.safeParse(
      task({ data: [{ name: "books", fields: [field] }] }),
    );
  }
  for (const type of ["text", "number", "boolean", "date"]) {
    assert(parseField({ name: "value", type, required: false }).success);
    assert.equal(
      parseField({ name: "value", type, required: false, options: ["one"] })
        .success,
      false,
    );
  }
  const enumField = { name: "status", type: "enum", required: true };
  for (const options of [undefined, [], [""], ["  "], ["one", " one "]]) {
    assert.equal(parseField({ ...enumField, options }).success, false);
  }
  assert(parseField({ ...enumField, options: ["one", "two"] }).success);
  assert.equal(
    parseField({ ...enumField, options: Array(13).fill("one") }).success,
    false,
  );
  assert.equal(
    parseField({ ...enumField, options: ["x".repeat(81)] }).success,
    false,
  );
  for (const name of [
    "Title",
    "1_title",
    "book-title",
    " title",
    "x".repeat(41),
  ]) {
    assert.equal(
      parseField({ name, type: "text", required: true }).success,
      false,
    );
  }
  for (const field of [
    { name: "title", type: "unknown", required: true },
    { name: "title", type: "text" },
    { name: "title", type: "text", required: "yes" },
    { name: "title", type: "text", required: true, permission: "write" },
  ]) {
    assert.equal(parseField(field).success, false);
  }
});

test("task rejects duplicate collection, field, and acceptance identifiers", () => {
  const source = task();
  assert.equal(
    taskSpecSchema.safeParse(task({ data: [source.data[0], source.data[0]] }))
      .success,
    false,
  );
  assert.equal(
    taskSpecSchema.safeParse(
      task({
        data: [
          {
            name: "books",
            fields: [source.data[0].fields[0], source.data[0].fields[0]],
          },
        ],
      }),
    ).success,
    false,
  );
  assert.equal(
    taskSpecSchema.safeParse(
      task({ acceptance: [source.acceptance[0], source.acceptance[0]] }),
    ).success,
    false,
  );
  assert(
    taskSpecSchema.safeParse(
      task({ data: [source.data[0], { ...source.data[0], name: "archive" }] }),
    ).success,
  );
});

test("task enforces individual text and array limits", () => {
  const source = task();
  for (const overrides of [
    { goal: " " },
    { goal: "x".repeat(4001) },
    { requirements: Array(17).fill("one") },
    { requirements: ["x".repeat(4001)] },
    { preserve: Array(17).fill("one") },
    { preserve: ["x".repeat(601)] },
    { data: Array(5).fill(source.data[0]) },
    { data: [{ name: "books", fields: [] }] },
    {
      data: [
        { name: "books", fields: Array(17).fill(source.data[0].fields[0]) },
      ],
    },
    { acceptance: Array(33).fill(source.acceptance[0]) },
    { acceptance: [{ ...source.acceptance[0], name: "x".repeat(161) }] },
    { acceptance: [{ ...source.acceptance[0], action: "x".repeat(1001) }] },
    { acceptance: [{ ...source.acceptance[0], expected: "x".repeat(1001) }] },
    { acceptance: [{ ...source.acceptance[0], kind: "manual" }] },
  ]) {
    assert.equal(taskSpecSchema.safeParse(task(overrides)).success, false);
  }
});

test("task caps serialized UTF-8 bytes including multibyte text", () => {
  const ascii = task({ requirements: Array(9).fill("a".repeat(4000)) });
  const multibyte = task({ requirements: Array(3).fill("读".repeat(4000)) });
  assert.equal(taskSpecSchema.safeParse(ascii).success, false);
  assert.equal(taskSpecSchema.safeParse(multibyte).success, false);
  assert(
    JSON.stringify(multibyte).length < 32768,
    "The multibyte rejection must depend on byte length, not character length",
  );
  const boundary = task({ data: [], acceptance: [], preserve: [] });
  const emptyOverhead = Buffer.byteLength(
    JSON.stringify({ ...boundary, requirements: Array(9).fill("") }),
  );
  const available = 32768 - emptyOverhead;
  boundary.requirements = Array.from({ length: 9 }, (_, index) =>
    "x".repeat(Math.min(4000, available - index * 4000)),
  );
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), 32768);
  assert(taskSpecSchema.safeParse(boundary).success);
  boundary.goal += "x";
  assert.equal(taskSpecSchema.safeParse(boundary).success, false);
});

test("legacy task fallback is deterministic and declares no fabricated checks", () => {
  const first = resolveTaskSpec("  Add a filter  ");
  const second = resolveTaskSpec("  Add a filter  ");
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    version: "1",
    goal: "Add a filter",
    requirements: ["Add a filter"],
    data: [],
    preserve: [
      "Preserve all existing working features unless the request explicitly changes them.",
    ],
    acceptance: [],
  });
  assert.notEqual(first, second);
  first.requirements.push("Changed");
  assert.deepEqual(second.requirements, ["Add a filter"]);
  assert.throws(() => resolveTaskSpec(" "));
  assert.throws(() => resolveTaskSpec("x".repeat(4001)));
});

test("resolving and canonicalizing a supplied task validates and detaches input", () => {
  const supplied = taskSpecSchema.parse(task());
  const resolved = resolveTaskSpec("Ignored prompt", supplied);
  assert.deepEqual(resolved, supplied);
  assert.notEqual(resolved, supplied);
  assert.notEqual(resolved.data, supplied.data);
  resolved.data[0].fields[0].name = "renamed";
  assert.equal(supplied.data[0].fields[0].name, "title");
  const reordered = {
    acceptance: supplied.acceptance,
    preserve: supplied.preserve,
    data: supplied.data,
    requirements: supplied.requirements,
    goal: supplied.goal,
    version: supplied.version,
  };
  assert.equal(canonicalTask(supplied), canonicalTask(reordered));
  assert.equal(canonicalTask(supplied), JSON.stringify(supplied));
  assert.throws(() =>
    resolveTaskSpec("Valid prompt", {
      ...supplied,
      version: "2",
    } as unknown as TaskSpec),
  );
});
