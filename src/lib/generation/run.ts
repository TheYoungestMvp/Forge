import "server-only";
import type { AppGeneratorProvider } from "@/lib/ai/provider";
import type { AppPlan, GenerateRequest, GeneratedApp } from "./schema";
import { GenerationError } from "./errors";
import { validateGeneratedApp } from "./validate";
import { resolveTaskSpec } from "./task";
import {
  createControlledTools,
  requireToolData,
  type ToolAuthority,
  type ToolHandlers,
  type ToolResultEvent,
  type ToolBudgetLimits,
} from "./tools";

export type GenerationPhase =
  "planning" | "generating" | "validating" | "repairing";

export type GenerationExecutionOptions = {
  authority?: ToolAuthority;
  budget?: Partial<ToolBudgetLimits>;
  baseVersionId?: string | null;
  onToolResult?: (event: ToolResultEvent) => void;
  saveVersion?: ToolHandlers["save_version"];
};

/** The production and offline evaluation paths share the same repair policy. */
export async function runAppGeneration(
  request: GenerateRequest,
  provider: AppGeneratorProvider,
  deadline: {
    signal: AbortSignal;
    check(): void;
    waitFor<T>(work: PromiseLike<T>): Promise<T>;
  },
  onPhase: (
    phase: GenerationPhase,
    plan?: AppPlan,
  ) => Promise<void> = async () => {},
  options: GenerationExecutionOptions = {},
) {
  const task = resolveTaskSpec(request.prompt, request.task);
  const toolTrace: ToolResultEvent[] = [];
  let currentApp = request.currentApp;
  const boundRequest = () => ({
    ...request,
    task,
    ...(currentApp ? { currentApp } : {}),
  });
  const authority = options.authority ?? {
    mode: "evaluation",
    capabilities: ["model:invoke", "app:validate"],
  };
  const tools = createControlledTools({
    authority,
    budget: options.budget,
    deadline,
    binding: { task, baseVersionId: options.baseVersionId ?? null },
    handlers: {
      read_project: () => ({ currentApp: currentApp ?? null }),
      plan_app: (_input, context) =>
        provider.plan(boundRequest(), context.signal),
      generate_app: async (input, context) => ({
        rawOutput: await provider.generate(
          boundRequest(),
          context.signal,
          undefined,
          input.plan,
        ),
      }),
      repair_app: async (input, context) => ({
        rawOutput: await provider.generate(
          boundRequest(),
          context.signal,
          input.feedback,
          input.plan,
        ),
      }),
      validate_app: ({ rawOutput }) => ({
        app: validateGeneratedApp(rawOutput),
        level: "static",
      }),
      ...(options.saveVersion ? { save_version: options.saveVersion } : {}),
    },
    onResult(event) {
      toolTrace.push(event);
      options.onToolResult?.(event);
    },
  });
  deadline.check();
  if (authority.mode === "project")
    currentApp =
      requireToolData(
        await tools.invoke("read_project", {
          projectId: authority.projectId,
          baseVersionId: options.baseVersionId ?? null,
        }),
        "read_project",
      ).currentApp ?? undefined;
  await onPhase("planning");
  const plan = requireToolData(
    await tools.invoke("plan_app", { task }),
    "plan_app",
  );
  deadline.check();
  await onPhase("generating", plan);
  const raw = requireToolData(
    await tools.invoke("generate_app", { task, plan }),
    "generate_app",
  ).rawOutput;
  deadline.check();
  await onPhase("validating");
  let app: GeneratedApp;
  let repairCount = 0;
  try {
    app = requireToolData(
      await tools.invoke("validate_app", { rawOutput: raw }),
      "validate_app",
    ).app;
  } catch (error) {
    if (
      !(error instanceof GenerationError) ||
      error.code !== "INVALID_GENERATED_APP"
    )
      throw error;
    deadline.check();
    await onPhase("repairing");
    repairCount = 1;
    const repaired = requireToolData(
      await tools.invoke("repair_app", {
        task,
        plan,
        feedback: error.message.slice(0, 600),
      }),
      "repair_app",
    ).rawOutput;
    app = requireToolData(
      await tools.invoke("validate_app", { rawOutput: repaired }),
      "validate_app",
    ).app;
  }
  deadline.check();
  return { app, plan, repairCount, task, tools, toolTrace };
}
