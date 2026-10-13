import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { generationDeadline } from "../src/lib/generation/deadline";
import { GenerationError } from "../src/lib/generation/errors";
import { resolveTaskSpec } from "../src/lib/generation/task";
import {
  controlledToolDefinitions,
  createControlledTools,
  requireToolData,
  TOOL_CONTRACT_VERSION,
  type ToolDataMap,
  type ToolResult,
  type ToolResultEvent,
} from "../src/lib/generation/tools";
import { validateGeneratedApp } from "../src/lib/generation/validate";

const task = resolveTaskSpec("Create a counter");
const plan = {
  steps: ["Build the counter display", "Wire the increment button"],
};
const app = {
  title: "Counter",
  html: '<main><button type="button">Increment</button><output>0</output></main>',
  css: "main { padding: 1rem; }",
  javascript:
    "let count=0; document.querySelector('button').addEventListener('click',()=>{ count++; document.querySelector('output').textContent=String(count); });",
};
const projectId = randomUUID();
const baseVersionId = randomUUID();
const projectAuthority = {
  mode: "project" as const,
  ownerId: randomUUID(),
  projectId,
  requestId: randomUUID(),
  runToken: randomUUID(),
  capabilities: [
    "project:read",
    "model:invoke",
    "app:validate",
    "browser:check",
    "version:save",
  ] as Parameters<typeof createControlledTools>[0]["authority"]["capabilities"],
};

function setup(
  overrides: Partial<Parameters<typeof createControlledTools>[0]> = {},
) {
  const deadline = generationDeadline(
    new Request("http://localhost"),
    Date.now(),
  );
  const tools = createControlledTools({
    authority: {
      mode: "evaluation",
      capabilities: ["model:invoke", "app:validate", "browser:check"],
    },
    deadline,
    handlers: {
      plan_app: () => plan,
      generate_app: () => ({ rawOutput: JSON.stringify(app) }),
      repair_app: () => ({ rawOutput: JSON.stringify(app) }),
      validate_app: ({ rawOutput }) => ({
        app: validateGeneratedApp(rawOutput),
        level: "static",
      }),
      run_checks: () => ({ checks: [], durationMs: 0, runtimeErrors: [] }),
      read_project: () => ({ currentApp: app }),
      save_version: () => ({ versionId: randomUUID() }),
    },
    ...overrides,
  });
  return { tools, deadline };
}

function failure(result: ToolResult, code: string) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected a failed tool result");
  assert.equal(result.error.code, code);
  return result;
}

test("tools expose versioned, strict input and result contracts", () => {
  assert.equal(TOOL_CONTRACT_VERSION, "1");
  assert.deepEqual(Object.keys(controlledToolDefinitions).sort(), [
    "generate_app",
    "plan_app",
    "read_project",
    "repair_app",
    "run_checks",
    "save_version",
    "validate_app",
  ]);
  assert.equal(controlledToolDefinitions.generate_app.modelCalls, 1);
  assert.equal(controlledToolDefinitions.repair_app.repairs, 1);
  assert.equal(
    controlledToolDefinitions.save_version.permission,
    "version:save",
  );
  assert.deepEqual(controlledToolDefinitions.run_checks.modes, ["evaluation"]);
  assert.equal(
    controlledToolDefinitions.generate_app.inputSchema.safeParse({
      task,
      plan,
      permissions: ["version:save"],
    }).success,
    false,
  );
  assert.equal(
    controlledToolDefinitions.validate_app.resultSchema.safeParse({
      app,
      level: "behavior",
    }).success,
    false,
  );
});

test("exported tool policy cannot be mutated to enable another execution mode", async () => {
  assert(Object.isFrozen(controlledToolDefinitions));
  assert(Object.isFrozen(controlledToolDefinitions.save_version));
  assert(Object.isFrozen(controlledToolDefinitions.save_version.modes));
  assert.throws(
    () => controlledToolDefinitions.save_version.modes.push("evaluation"),
    TypeError,
  );
  assert.throws(() => {
    controlledToolDefinitions.save_version.permission = "model:invoke";
  }, TypeError);
  const { tools, deadline } = setup({
    authority: {
      mode: "evaluation",
      projectId,
      capabilities: ["version:save", "model:invoke"],
    },
  });
  try {
    failure(
      await tools.invoke("save_version", { projectId, baseVersionId, app }),
      "TOOL_FORBIDDEN",
    );
  } finally {
    deadline.close();
  }
});

test("unknown tools, malformed inputs, and injected authority never reach handlers", async () => {
  for (const [name, input, code] of [
    ["shell", { command: "delete" }, "UNKNOWN_TOOL"],
    [
      "generate_app",
      { task, plan, ownerId: projectAuthority.ownerId },
      "TOOL_INVALID_INPUT",
    ],
    [
      "generate_app",
      { task, plan, budget: { maxModelCalls: 100 } },
      "TOOL_INVALID_INPUT",
    ],
    ["plan_app", { task: { ...task, tools: ["shell"] } }, "TOOL_INVALID_INPUT"],
    ["plan_app", null, "TOOL_INVALID_INPUT"],
  ] as const) {
    let calls = 0;
    const { tools, deadline } = setup({
      handlers: {
        plan_app: () => {
          calls++;
          return plan;
        },
        generate_app: () => {
          calls++;
          return { rawOutput: "{}" };
        },
      },
    });
    try {
      const result = failure(await tools.invoke(name, input), code);
      assert.equal(result.error.outcome, "not_started");
      assert.equal(calls, 0);
      assert.equal(result.budget.used.modelCalls, 0);
    } finally {
      deadline.close();
    }
  }
});

test("tool invocation rejects missing capabilities and isolates project scope", async () => {
  let calls = 0;
  const cases = [
    {
      authority: { mode: "evaluation" as const, capabilities: [] },
      name: "plan_app",
      input: { task },
      code: "TOOL_FORBIDDEN",
    },
    {
      authority: projectAuthority,
      name: "read_project",
      input: { projectId: randomUUID(), baseVersionId },
      code: "TOOL_SCOPE_MISMATCH",
    },
    {
      authority: projectAuthority,
      name: "read_project",
      input: { projectId, baseVersionId: null },
      code: "TOOL_BASELINE_MISMATCH",
    },
    {
      authority: projectAuthority,
      name: "plan_app",
      input: { task: resolveTaskSpec("Different request") },
      code: "TOOL_TASK_MISMATCH",
    },
  ];
  for (const entry of cases) {
    const { tools, deadline } = setup({
      authority: entry.authority,
      binding: { task, baseVersionId },
      handlers: {
        plan_app: () => {
          calls++;
          return plan;
        },
        read_project: () => {
          calls++;
          return { currentApp: app };
        },
      },
    });
    try {
      const result = failure(
        await tools.invoke(entry.name, entry.input),
        entry.code,
      );
      assert.equal(result.error.outcome, "not_started");
      assert.equal(result.budget.used.modelCalls, 0);
    } finally {
      deadline.close();
    }
  }
  assert.equal(calls, 0);
});

test("project reads and saves are unavailable in evaluation despite explicit capabilities", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    authority: {
      mode: "evaluation",
      projectId,
      capabilities: ["project:read", "version:save"],
    },
    handlers: {
      read_project: () => {
        calls++;
        return { currentApp: app };
      },
      save_version: () => {
        calls++;
        return { versionId: randomUUID() };
      },
    },
  });
  try {
    for (const [name, input] of [
      ["read_project", { projectId, baseVersionId }],
      ["save_version", { projectId, baseVersionId, app }],
    ] as const) {
      failure(await tools.invoke(name, input), "TOOL_FORBIDDEN");
    }
    assert.equal(calls, 0);
  } finally {
    deadline.close();
  }
});

test("unsafe apps cannot reach save or browser-check handlers", async () => {
  for (const unsafe of [
    {
      ...app,
      html: '<main><iframe src="https://example.invalid"></iframe></main>',
    },
    { ...app, javascript: "fetch('https://example.invalid/private');" },
  ]) {
    let calls = 0;
    const saving = setup({
      authority: projectAuthority,
      binding: { task, baseVersionId },
      handlers: {
        save_version: () => {
          calls++;
          return { versionId: randomUUID() };
        },
      },
    });
    const checking = setup({
      handlers: {
        run_checks: () => {
          calls++;
          return { checks: [], durationMs: 0, runtimeErrors: [] };
        },
      },
    });
    try {
      for (const result of [
        await saving.tools.invoke("save_version", {
          projectId,
          baseVersionId,
          app: unsafe,
        }),
        await checking.tools.invoke("run_checks", {
          taskId: "counter",
          app: unsafe,
        }),
      ]) {
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("Unsafe apps must fail before handlers");
        assert.equal(result.error.code, "TOOL_INVALID_INPUT");
        assert.equal(result.error.outcome, "not_started");
        assert.equal(result.budget.used.modelCalls, 0);
      }
      assert.equal(calls, 0);
    } finally {
      saving.deadline.close();
      checking.deadline.close();
    }
  }
});

test("project execution requires complete trusted authority at construction", () => {
  const deadline = generationDeadline(
    new Request("http://localhost"),
    Date.now(),
  );
  try {
    assert.throws(
      () =>
        createControlledTools({
          authority: { mode: "project", capabilities: [] },
          handlers: {},
          deadline,
        }),
      (error: unknown) =>
        error instanceof GenerationError &&
        error.code === "TOOL_CONFIGURATION_ERROR",
    );
    for (const budget of [
      { maxToolCalls: 8 },
      { maxModelCalls: 4 },
      { maxRepairs: 2 },
      { maxOutputTokens: 25201 },
      { maxInputBytes: 1048577 },
      { maxToolCalls: 0 },
    ]) {
      assert.throws(() =>
        createControlledTools({
          authority: { mode: "evaluation", capabilities: [] },
          handlers: {},
          deadline,
          budget,
        }),
      );
    }
  } finally {
    deadline.close();
  }
});

test("input byte budget rejects before a model or handler starts", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    budget: { maxInputBytes: 1 },
    handlers: {
      plan_app: () => {
        calls++;
        return plan;
      },
    },
  });
  try {
    const result = failure(
      await tools.invoke("plan_app", { task }),
      "TOOL_INPUT_TOO_LARGE",
    );
    assert.equal(result.error.status, 413);
    assert.equal(calls, 0);
    assert.deepEqual(result.budget.used, {
      toolCalls: 1,
      modelCalls: 0,
      repairs: 0,
      outputTokens: 0,
    });
  } finally {
    deadline.close();
  }
});

test("model and repair limits reject before further provider calls", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    handlers: {
      plan_app: () => {
        calls++;
        return plan;
      },
      repair_app: () => {
        calls++;
        return { rawOutput: "{}" };
      },
    },
  });
  try {
    for (let index = 0; index < 3; index++)
      assert.equal((await tools.invoke("plan_app", { task })).ok, true);
    const result = failure(
      await tools.invoke("plan_app", { task }),
      "TOOL_BUDGET_EXHAUSTED",
    );
    assert.equal(calls, 3);
    assert.equal(result.budget.used.modelCalls, 3);
    assert.equal(result.budget.used.outputTokens, 3600);
    assert.equal(result.error.outcome, "not_started");
  } finally {
    deadline.close();
  }
  const repairSetup = setup({
    handlers: {
      repair_app: () => {
        calls++;
        return { rawOutput: "{}" };
      },
    },
  });
  try {
    assert.equal(
      (
        await repairSetup.tools.invoke("repair_app", {
          task,
          plan,
          feedback: "Fix the invalid app",
        })
      ).ok,
      true,
    );
    failure(
      await repairSetup.tools.invoke("repair_app", {
        task,
        plan,
        feedback: "Try another repair",
      }),
      "TOOL_BUDGET_EXHAUSTED",
    );
    assert.equal(calls, 4);
    assert.equal(repairSetup.tools.snapshot().used.repairs, 1);
  } finally {
    repairSetup.deadline.close();
  }
});

test("output reservations and total tool-call budget cannot be overdrawn", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    budget: { maxOutputTokens: 13199 },
    handlers: {
      plan_app: () => {
        calls++;
        return plan;
      },
      generate_app: () => {
        calls++;
        return { rawOutput: "{}" };
      },
    },
  });
  try {
    assert.equal((await tools.invoke("plan_app", { task })).ok, true);
    const result = failure(
      await tools.invoke("generate_app", { task, plan }),
      "TOOL_BUDGET_EXHAUSTED",
    );
    assert.equal(calls, 1);
    assert.equal(result.budget.used.outputTokens, 1200);
    assert.equal(result.budget.remaining.outputTokens, 11999);
  } finally {
    deadline.close();
  }
  const limited = setup({
    budget: { maxToolCalls: 1 },
    handlers: {
      plan_app: () => {
        calls++;
        return plan;
      },
    },
  });
  try {
    failure(await limited.tools.invoke("unknown", {}), "UNKNOWN_TOOL");
    failure(
      await limited.tools.invoke("plan_app", { task }),
      "TOOL_BUDGET_EXHAUSTED",
    );
    assert.equal(calls, 1);
    assert.equal(limited.tools.snapshot().used.toolCalls, 1);
  } finally {
    limited.deadline.close();
  }
});

test("concurrent repeat call IDs share one handler and charge once", async () => {
  let calls = 0;
  let complete!: (value: ToolDataMap["generate_app"]) => void;
  const pending = new Promise<ToolDataMap["generate_app"]>((resolve) => {
    complete = resolve;
  });
  const events: ToolResultEvent[] = [];
  const { tools, deadline } = setup({
    handlers: {
      generate_app: () => {
        calls++;
        return pending;
      },
    },
    onResult: (event) => {
      events.push(event);
    },
  });
  try {
    const callId = randomUUID();
    const first = tools.invoke("generate_app", { task, plan }, callId);
    const repeated = tools.invoke("generate_app", { task, plan }, callId);
    const reordered = tools.invoke("generate_app", { plan, task }, callId);
    assert.equal(first, repeated);
    assert.equal(first, reordered);
    assert.equal(calls, 1);
    const conflict = failure(
      await tools.invoke(
        "generate_app",
        { task: resolveTaskSpec("Different task"), plan },
        callId,
      ),
      "TOOL_CALL_CONFLICT",
    );
    assert.equal(conflict.error.status, 409);
    complete({ rawOutput: JSON.stringify(app) });
    const results = await Promise.all([first, repeated]);
    assert.equal(results[0], results[1]);
    assert.equal(results[0].ok, true);
    assert.equal(calls, 1);
    assert.deepEqual(tools.snapshot().used, {
      toolCalls: 1,
      modelCalls: 1,
      repairs: 0,
      outputTokens: 12000,
    });
    assert.equal(events.filter((event) => event.ok).length, 1);
  } finally {
    deadline.close();
  }
});

test("missing handlers and malformed results produce structured failures", async () => {
  const missing = setup({ handlers: {} });
  try {
    const result = failure(
      await missing.tools.invoke("plan_app", { task }),
      "TOOL_UNAVAILABLE",
    );
    assert.equal(result.error.outcome, "not_started");
    assert.equal(result.budget.used.modelCalls, 0);
  } finally {
    missing.deadline.close();
  }
  const secret = "provider-api-secret";
  const malformed = setup({
    handlers: {
      generate_app: () =>
        ({ rawOutput: "{}", secret }) as ToolDataMap["generate_app"],
    },
  });
  try {
    const result = failure(
      await malformed.tools.invoke("generate_app", { task, plan }),
      "TOOL_INVALID_RESULT",
    );
    assert.equal(result.error.outcome, "failed");
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.budget.used.modelCalls, 1);
  } finally {
    malformed.deadline.close();
  }
});

test("unexpected errors stay sanitized and observers cannot change execution", async () => {
  const secret = "private-api-key-and-endpoint";
  const crashing = setup({
    handlers: {
      generate_app: () => {
        throw new Error(secret);
      },
    },
    onResult: () => {
      throw new Error("observer failed");
    },
  });
  try {
    const result = failure(
      await crashing.tools.invoke("generate_app", { task, plan }),
      "TOOL_EXECUTION_FAILED",
    );
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.error.outcome, "unknown");
    assert.equal(result.error.recovery, "reload_state");
  } finally {
    crashing.deadline.close();
  }
  const observed = setup({
    onResult: (event) => {
      event.budget.used.modelCalls = 99;
      return Promise.reject(new Error("async observer failed"));
    },
  });
  try {
    const result = await observed.tools.invoke("plan_app", { task });
    assert.equal(result.ok, true);
    assert.equal(result.budget.used.modelCalls, 1);
    assert.equal(observed.tools.snapshot().used.modelCalls, 1);
  } finally {
    observed.deadline.close();
  }
});

test("abort before invocation prevents handlers and preserves provider budget", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    handlers: {
      generate_app: () => {
        calls++;
        return { rawOutput: "{}" };
      },
    },
  });
  try {
    deadline.abort();
    const result = failure(
      await tools.invoke("generate_app", { task, plan }),
      "GENERATION_TIMEOUT",
    );
    assert.equal(result.error.outcome, "not_started");
    assert.equal(calls, 0);
    assert.equal(result.budget.used.modelCalls, 0);
  } finally {
    deadline.close();
  }
});

test("abort while awaiting a handler remains unknown and late completion cannot replace it", async () => {
  let complete!: (value: ToolDataMap["generate_app"]) => void;
  const pending = new Promise<ToolDataMap["generate_app"]>((resolve) => {
    complete = resolve;
  });
  let calls = 0;
  const { tools, deadline } = setup({
    handlers: {
      generate_app: () => {
        calls++;
        return pending;
      },
    },
  });
  try {
    const callId = randomUUID();
    const executing = tools.invoke("generate_app", { task, plan }, callId);
    assert.equal(calls, 1);
    deadline.abort();
    const result = failure(await executing, "GENERATION_TIMEOUT");
    assert.equal(result.error.outcome, "unknown");
    assert.equal(result.error.recovery, "reload_state");
    complete({ rawOutput: JSON.stringify(app) });
    await Promise.resolve();
    assert.equal(
      await tools.invoke("generate_app", { task, plan }, callId),
      result,
    );
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(tools.snapshot().used.modelCalls, 1);
  } finally {
    deadline.close();
  }
});

test("validation suggests a repair only while the repair budget remains", async () => {
  const { tools, deadline } = setup();
  try {
    const before = failure(
      await tools.invoke("validate_app", { rawOutput: "invalid json" }),
      "INVALID_GENERATED_APP",
    );
    assert.equal(before.error.outcome, "failed");
    assert.equal(before.error.recovery, "repair_output");
    assert.equal(
      (
        await tools.invoke("repair_app", {
          task,
          plan,
          feedback: before.error.message,
        })
      ).ok,
      true,
    );
    const after = failure(
      await tools.invoke("validate_app", { rawOutput: "invalid json" }),
      "INVALID_GENERATED_APP",
    );
    assert.equal(after.error.recovery, "none");
    assert.equal(after.budget.used.repairs, 1);
    const validated = await tools.invoke("validate_app", {
      rawOutput: JSON.stringify(app),
    });
    assert.deepEqual(requireToolData(validated, "validate_app"), {
      app,
      level: "static",
    });
  } finally {
    deadline.close();
  }
});

test("requireToolData preserves structured failure and rejects another tool's output", async () => {
  const { tools, deadline } = setup({
    authority: { mode: "evaluation", capabilities: [] },
  });
  try {
    const result = failure(
      await tools.invoke("plan_app", { task }),
      "TOOL_FORBIDDEN",
    );
    assert.throws(
      () => requireToolData(result, "plan_app"),
      (error: unknown) =>
        error instanceof GenerationError &&
        error.failure?.tool === "plan_app" &&
        error.failure.callId === result.callId &&
        error.failure.outcome === "not_started",
    );
  } finally {
    deadline.close();
  }
  const success = setup();
  try {
    const result = await success.tools.invoke("plan_app", { task });
    assert.throws(
      () => requireToolData(result, "generate_app"),
      (error: unknown) =>
        error instanceof GenerationError &&
        error.code === "TOOL_INVALID_RESULT",
    );
  } finally {
    success.deadline.close();
  }
});

test("malformed call IDs and unserializable input never invoke handlers", async () => {
  let calls = 0;
  const { tools, deadline } = setup({
    handlers: {
      plan_app: () => {
        calls++;
        return plan;
      },
    },
  });
  try {
    const invalidId = failure(
      await tools.invoke("plan_app", { task }, "not-a-uuid"),
      "TOOL_INVALID_INPUT",
    );
    assert.equal(invalidId.callId, null);
    const circular: { task: typeof task; self?: unknown } = { task };
    circular.self = circular;
    failure(await tools.invoke("plan_app", circular), "TOOL_INVALID_INPUT");
    assert.equal(calls, 0);
    assert.equal(tools.snapshot().used.toolCalls, 0);
  } finally {
    deadline.close();
  }
});
