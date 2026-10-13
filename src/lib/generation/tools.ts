import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appPlanSchema, generatedAppSchema } from "./schema";
import { canonicalTask, taskSpecSchema, type TaskSpec } from "./task";
import { GenerationError } from "./errors";
import { validateGeneratedApp } from "./validate";
import {
  MODEL_OUTPUT_BUDGETS,
  MAX_MODEL_CALLS,
  MAX_REPAIR_CALLS,
  MAX_RESERVED_OUTPUT_TOKENS,
} from "./limits";
import type { ToolError } from "./tool-failure";

export const TOOL_CONTRACT_VERSION = "1";
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const rawOutput = z.string().refine((value) => bytes(value) <= 1_048_576);
const projectInput = z.strictObject({
  projectId: z.uuid(),
  baseVersionId: z.uuid().nullable(),
});
const inputSchemas = {
  read_project: projectInput,
  plan_app: z.strictObject({ task: taskSpecSchema }),
  generate_app: z.strictObject({ task: taskSpecSchema, plan: appPlanSchema }),
  repair_app: z.strictObject({
    task: taskSpecSchema,
    plan: appPlanSchema,
    feedback: z.string().trim().min(1).max(600),
  }),
  validate_app: z.strictObject({ rawOutput }),
  run_checks: z.strictObject({
    taskId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    app: generatedAppSchema,
  }),
  save_version: projectInput.extend({ app: generatedAppSchema }),
} as const;
const checkResultSchema = z.strictObject({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  kind: z.enum(["behavior", "regression"]),
  passed: z.boolean(),
  status: z.enum(["passed", "failed", "not_run"]).optional(),
  error: z.string().max(2000).optional(),
});
const outputSchemas = {
  read_project: z.strictObject({ currentApp: generatedAppSchema.nullable() }),
  plan_app: appPlanSchema,
  generate_app: z.strictObject({ rawOutput }),
  repair_app: z.strictObject({ rawOutput }),
  validate_app: z.strictObject({
    app: generatedAppSchema,
    level: z.literal("static"),
  }),
  run_checks: z.strictObject({
    checks: z.array(checkResultSchema).max(64),
    durationMs: z.number().finite().nonnegative(),
    runtimeErrors: z.array(z.string().max(2000)).max(64),
    failureCode: z.string().max(80).optional(),
    browserVersion: z.string().max(200).optional(),
    fixedBrowserTime: z.string().max(100).optional(),
  }),
  save_version: z.strictObject({ versionId: z.uuid() }),
} as const;
export type ToolName = keyof typeof inputSchemas;
export type ToolCapability =
  | "project:read"
  | "model:invoke"
  | "app:validate"
  | "browser:check"
  | "version:save";
export type ToolInputMap = {
  [K in ToolName]: z.infer<(typeof inputSchemas)[K]>;
};
export type ToolDataMap = {
  [K in ToolName]: z.infer<(typeof outputSchemas)[K]>;
};
export type ToolAuthority = {
  mode: "project" | "evaluation";
  ownerId?: string;
  projectId?: string;
  requestId?: string;
  runToken?: string;
  capabilities: ToolCapability[];
};
export type ToolBudgetLimits = {
  maxToolCalls: number;
  maxModelCalls: number;
  maxRepairs: number;
  maxOutputTokens: number;
  maxInputBytes: number;
};
type Counters = {
  toolCalls: number;
  modelCalls: number;
  repairs: number;
  outputTokens: number;
};
export type ToolBudgetSnapshot = {
  limits: ToolBudgetLimits;
  used: Counters;
  remaining: Counters;
};
export type ToolResult =
  | {
      ok: true;
      callId: string;
      tool: ToolName;
      data: ToolDataMap[ToolName];
      budget: ToolBudgetSnapshot;
    }
  | {
      ok: false;
      callId: string | null;
      tool: ToolName | "unknown";
      error: ToolError;
      budget: ToolBudgetSnapshot;
    };
export type ToolResultEvent = {
  callId: string | null;
  tool: ToolName | "unknown";
  ok: boolean;
  error?: ToolError;
  budget: ToolBudgetSnapshot;
  durationMs: number;
};
export type ToolHandlers = {
  [K in ToolName]?: (
    input: ToolInputMap[K],
    context: { signal: AbortSignal; callId: string; tool: K },
  ) => ToolDataMap[K] | Promise<ToolDataMap[K]>;
};
type Definition = {
  permission: ToolCapability;
  modes: ("project" | "evaluation")[];
  modelCalls: number;
  repairs: number;
  outputTokens: number;
};
const definitions: Record<ToolName, Definition> = {
  read_project: {
    permission: "project:read",
    modes: ["project"],
    modelCalls: 0,
    repairs: 0,
    outputTokens: 0,
  },
  plan_app: {
    permission: "model:invoke",
    modes: ["project", "evaluation"],
    modelCalls: 1,
    repairs: 0,
    outputTokens: MODEL_OUTPUT_BUDGETS.plan,
  },
  generate_app: {
    permission: "model:invoke",
    modes: ["project", "evaluation"],
    modelCalls: 1,
    repairs: 0,
    outputTokens: MODEL_OUTPUT_BUDGETS.generate,
  },
  repair_app: {
    permission: "model:invoke",
    modes: ["project", "evaluation"],
    modelCalls: 1,
    repairs: 1,
    outputTokens: MODEL_OUTPUT_BUDGETS.repair,
  },
  validate_app: {
    permission: "app:validate",
    modes: ["project", "evaluation"],
    modelCalls: 0,
    repairs: 0,
    outputTokens: 0,
  },
  run_checks: {
    permission: "browser:check",
    modes: ["evaluation"],
    modelCalls: 0,
    repairs: 0,
    outputTokens: 0,
  },
  save_version: {
    permission: "version:save",
    modes: ["project"],
    modelCalls: 0,
    repairs: 0,
    outputTokens: 0,
  },
};
for (const definition of Object.values(definitions)) {
  Object.freeze(definition.modes);
  Object.freeze(definition);
}
export const controlledToolDefinitions = Object.freeze(
  Object.fromEntries(
    (Object.keys(definitions) as ToolName[]).map((name) => [
      name,
      Object.freeze({
        ...definitions[name],
        modes: Object.freeze([...definitions[name].modes]),
        inputSchema: inputSchemas[name],
        resultSchema: outputSchemas[name],
        maxInputBytes: 1_048_576,
      }),
    ]),
  ),
) as {
  [K in ToolName]: Definition & {
    inputSchema: (typeof inputSchemas)[K];
    resultSchema: (typeof outputSchemas)[K];
    maxInputBytes: number;
  };
};
const budgetSchema = z.strictObject({
  maxToolCalls: z.number().int().min(1).max(7),
  maxModelCalls: z.number().int().min(0).max(MAX_MODEL_CALLS),
  maxRepairs: z.number().int().min(0).max(MAX_REPAIR_CALLS),
  maxOutputTokens: z.number().int().min(0).max(MAX_RESERVED_OUTPUT_TOKENS),
  maxInputBytes: z.number().int().min(1).max(1_048_576),
});
export type ControlledTools = ReturnType<typeof createControlledTools>;
export type ToolDeadline = {
  signal: AbortSignal;
  check(): void;
  waitFor<T>(work: PromiseLike<T>): Promise<T>;
};

export function createControlledTools(options: {
  authority: ToolAuthority;
  budget?: Partial<ToolBudgetLimits>;
  deadline: ToolDeadline;
  handlers: ToolHandlers;
  binding?: { task: TaskSpec; baseVersionId: string | null };
  onResult?: (event: ToolResultEvent) => void;
}) {
  const limits = budgetSchema.parse({
    maxToolCalls: 7,
    maxModelCalls: MAX_MODEL_CALLS,
    maxRepairs: MAX_REPAIR_CALLS,
    maxOutputTokens: MAX_RESERVED_OUTPUT_TOKENS,
    maxInputBytes: 1_048_576,
    ...options.budget,
  });
  const used: Counters = {
    toolCalls: 0,
    modelCalls: 0,
    repairs: 0,
    outputTokens: 0,
  };
  const authority = z
    .strictObject({
      mode: z.enum(["project", "evaluation"]),
      ownerId: z.uuid().optional(),
      projectId: z.uuid().optional(),
      requestId: z.uuid().optional(),
      runToken: z.uuid().optional(),
      capabilities: z
        .array(
          z.enum([
            "project:read",
            "model:invoke",
            "app:validate",
            "browser:check",
            "version:save",
          ]),
        )
        .max(5),
    })
    .parse(options.authority);
  if (
    authority.mode === "project" &&
    (!authority.ownerId ||
      !authority.projectId ||
      !authority.requestId ||
      !authority.runToken)
  )
    throw new GenerationError(
      "TOOL_CONFIGURATION_ERROR",
      "Project tools require a server-bound owner, project, request and execution token.",
      503,
    );
  const boundTask = options.binding
    ? canonicalTask(options.binding.task)
    : null;
  const baseVersionId = options.binding?.baseVersionId;
  const cache = new Map<
    string,
    { signature: string; result: Promise<ToolResult> }
  >();
  function snapshot(): ToolBudgetSnapshot {
    return {
      limits: { ...limits },
      used: { ...used },
      remaining: {
        toolCalls: limits.maxToolCalls - used.toolCalls,
        modelCalls: limits.maxModelCalls - used.modelCalls,
        repairs: limits.maxRepairs - used.repairs,
        outputTokens: limits.maxOutputTokens - used.outputTokens,
      },
    };
  }
  function fail(
    callId: string | null,
    tool: ToolName | "unknown",
    code: string,
    message: string,
    status = 400,
    outcome: ToolError["outcome"] = "not_started",
    recovery: ToolError["recovery"] = "none",
  ): ToolResult {
    return {
      ok: false,
      callId,
      tool,
      error: { code, message, status, outcome, recovery },
      budget: snapshot(),
    };
  }
  function publish(result: ToolResult, started: number) {
    const event: ToolResultEvent = {
      callId: result.callId,
      tool: result.tool,
      ok: result.ok,
      ...(!result.ok ? { error: { ...result.error } } : {}),
      budget: structuredClone(result.budget),
      durationMs: performance.now() - started,
    };
    try {
      void Promise.resolve(options.onResult?.(event)).catch(() => {});
    } catch {
      /* Observation cannot change execution. */
    }
    return result;
  }
  function publicFailure(
    error: unknown,
    callId: string,
    tool: ToolName,
  ): ToolResult {
    if (error instanceof GenerationError) {
      const unknown =
        options.deadline.signal.aborted ||
        /TIMEOUT|UNREACHABLE|UNAVAILABLE|UNCONFIRMED|INTERRUPTED/.test(
          error.code,
        );
      const recovery =
        error.code === "INVALID_GENERATED_APP" &&
        used.repairs < limits.maxRepairs
          ? "repair_output"
          : unknown
            ? "reload_state"
            : /RATE_LIMIT|AUTH_ERROR|CONFIGURATION/.test(error.code)
              ? "retry_request"
              : "none";
      return fail(
        callId,
        tool,
        error.code,
        error.message.slice(0, 600),
        error.status,
        unknown ? "unknown" : "failed",
        recovery,
      );
    }
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : null;
    if (
      typeof code === "string" &&
      [
        "CALL_BUDGET_EXHAUSTED",
        "COST_BUDGET_EXHAUSTED",
        "COST_UNKNOWN",
        "EVALUATION_CANCELLED",
      ].includes(code)
    )
      return fail(
        callId,
        tool,
        code,
        "The evaluation budget or cancellation stopped this operation.",
        429,
        "not_started",
      );
    return fail(
      callId,
      tool,
      "TOOL_EXECUTION_FAILED",
      "The controlled tool failed. Saved versions are kept.",
      502,
      "unknown",
      "reload_state",
    );
  }
  async function execute(
    tool: ToolName | "unknown",
    input: unknown,
    callId: string,
  ): Promise<ToolResult> {
    if (used.toolCalls >= limits.maxToolCalls)
      return fail(
        callId,
        tool,
        "TOOL_BUDGET_EXHAUSTED",
        "The tool-call budget has been exhausted.",
        429,
      );
    used.toolCalls++;
    if (tool === "unknown")
      return fail(
        callId,
        tool,
        "UNKNOWN_TOOL",
        "This tool is not in the allowed tool registry.",
        400,
      );
    const parsed = inputSchemas[tool].safeParse(input);
    if (!parsed.success)
      return fail(
        callId,
        tool,
        "TOOL_INVALID_INPUT",
        "The tool input does not match its declared schema.",
        400,
      );
    if (bytes(JSON.stringify(parsed.data)) > limits.maxInputBytes)
      return fail(
        callId,
        tool,
        "TOOL_INPUT_TOO_LARGE",
        "The tool input exceeds its byte budget.",
        413,
      );
    const definition = definitions[tool];
    if (
      !definition.modes.includes(authority.mode) ||
      !authority.capabilities.includes(definition.permission)
    )
      return fail(
        callId,
        tool,
        "TOOL_FORBIDDEN",
        "This execution has no permission to use this tool.",
        403,
      );
    if (
      "projectId" in parsed.data &&
      parsed.data.projectId !== authority.projectId
    )
      return fail(
        callId,
        tool,
        "TOOL_SCOPE_MISMATCH",
        "The tool target does not match the server-bound project.",
        403,
      );
    if (
      "baseVersionId" in parsed.data &&
      baseVersionId !== undefined &&
      parsed.data.baseVersionId !== baseVersionId
    )
      return fail(
        callId,
        tool,
        "TOOL_BASELINE_MISMATCH",
        "The tool target does not match the bound source version.",
        409,
      );
    if (
      "task" in parsed.data &&
      boundTask !== null &&
      canonicalTask(parsed.data.task) !== boundTask
    )
      return fail(
        callId,
        tool,
        "TOOL_TASK_MISMATCH",
        "The task cannot change during an execution.",
        409,
      );
    if (!options.handlers[tool])
      return fail(
        callId,
        tool,
        "TOOL_UNAVAILABLE",
        "This tool is not installed in this execution.",
        503,
      );
    if ("app" in parsed.data) {
      try {
        validateGeneratedApp(JSON.stringify(parsed.data.app));
      } catch {
        return fail(
          callId,
          tool,
          "TOOL_INVALID_INPUT",
          "The application input does not pass static validation.",
          400,
        );
      }
    }
    try {
      options.deadline.check();
    } catch (error) {
      const failure = publicFailure(error, callId, tool);
      if (!failure.ok) failure.error.outcome = "not_started";
      return failure;
    }
    if (options.deadline.signal.aborted)
      return fail(
        callId,
        tool,
        "GENERATION_TIMEOUT",
        "The execution was interrupted before this tool started.",
        504,
      );
    if (
      used.modelCalls + definition.modelCalls > limits.maxModelCalls ||
      used.repairs + definition.repairs > limits.maxRepairs ||
      used.outputTokens + definition.outputTokens > limits.maxOutputTokens
    )
      return fail(
        callId,
        tool,
        "TOOL_BUDGET_EXHAUSTED",
        "The model-call, repair or output-token budget has been exhausted.",
        429,
      );
    used.modelCalls += definition.modelCalls;
    used.repairs += definition.repairs;
    used.outputTokens += definition.outputTokens;
    try {
      // All inputs have been parsed before a handler gains access to the signal.
      const handler = options.handlers[tool] as (
        data: typeof parsed.data,
        context: { signal: AbortSignal; callId: string; tool: ToolName },
      ) => unknown;
      const output = await options.deadline.waitFor(
        Promise.resolve(
          handler(parsed.data, {
            signal: options.deadline.signal,
            callId,
            tool,
          }),
        ),
      );
      const validated = outputSchemas[tool].safeParse(output);
      if (!validated.success)
        return fail(
          callId,
          tool,
          "TOOL_INVALID_RESULT",
          "The tool result does not match its declared schema.",
          502,
          "failed",
        );
      const app =
        "app" in validated.data
          ? validated.data.app
          : "currentApp" in validated.data
            ? validated.data.currentApp
            : null;
      if (app) {
        try {
          validateGeneratedApp(JSON.stringify(app));
        } catch {
          return fail(
            callId,
            tool,
            "TOOL_INVALID_RESULT",
            "The application result does not pass static validation.",
            502,
            "failed",
          );
        }
      }
      if (bytes(JSON.stringify(validated.data)) > 1_048_576)
        return fail(
          callId,
          tool,
          "TOOL_RESULT_TOO_LARGE",
          "The tool result exceeds its byte limit.",
          502,
          "failed",
        );
      options.deadline.check();
      return {
        ok: true,
        callId,
        tool,
        data: validated.data,
        budget: snapshot(),
      };
    } catch (error) {
      return publicFailure(error, callId, tool);
    }
  }
  function invoke(
    name: string,
    input: unknown,
    suppliedId?: string,
  ): Promise<ToolResult> {
    const started = performance.now();
    const callId = suppliedId ?? randomUUID();
    const tool: ToolName | "unknown" = Object.hasOwn(definitions, name)
      ? (name as ToolName)
      : "unknown";
    if (!z.uuid().safeParse(callId).success)
      return Promise.resolve(
        publish(
          fail(
            null,
            tool,
            "TOOL_INVALID_INPUT",
            "A tool call ID must be a UUID.",
          ),
          started,
        ),
      );
    let signature: string;
    function ordered(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(ordered);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              ordered((value as Record<string, unknown>)[key]),
            ]),
        );
      return value;
    }
    try {
      signature = JSON.stringify({ name, input: ordered(input) });
    } catch {
      return Promise.resolve(
        publish(
          fail(
            callId,
            tool,
            "TOOL_INVALID_INPUT",
            "The tool input must be serializable.",
          ),
          started,
        ),
      );
    }
    const previous = cache.get(callId);
    if (previous)
      return previous.signature === signature
        ? previous.result
        : Promise.resolve(
            publish(
              fail(
                callId,
                tool,
                "TOOL_CALL_CONFLICT",
                "A tool call ID was reused with different inputs.",
                409,
              ),
              started,
            ),
          );
    const result = execute(tool, input, callId).then((value) =>
      publish(value, started),
    );
    if (cache.size < limits.maxToolCalls)
      cache.set(callId, { signature, result });
    return result;
  }
  return { invoke, snapshot };
}

export function requireToolData<K extends ToolName>(
  result: ToolResult,
  tool: K,
): ToolDataMap[K] {
  if (!result.ok)
    throw new GenerationError(
      result.error.code,
      result.error.message,
      result.error.status,
      { ...result.error, tool: result.tool, callId: result.callId },
    );
  if (result.tool !== tool)
    throw new GenerationError(
      "TOOL_INVALID_RESULT",
      "The tool result belongs to another operation.",
      502,
    );
  return result.data as ToolDataMap[K];
}
