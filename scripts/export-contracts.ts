import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  taskSpecSchema,
  TASK_CONTRACT_VERSION,
} from "../src/lib/generation/task";
import {
  controlledToolDefinitions,
  TOOL_CONTRACT_VERSION,
} from "../src/lib/generation/tools";
import {
  toolFailureSchema,
  toolFailureResultSchema,
  toolBudgetSnapshotSchema,
} from "../src/lib/generation/tool-failure";
import {
  MAX_MODEL_CALLS,
  MAX_REPAIR_CALLS,
  MAX_RESERVED_OUTPUT_TOKENS,
} from "../src/lib/generation/limits";

async function main() {
  const directory = resolve("contracts");
  await mkdir(directory, { recursive: true });
  const task = {
    ...z.toJSONSchema(taskSpecSchema),
    "x-contract-version": TASK_CONTRACT_VERSION,
    "x-runtime-validation": {
      maxUtf8Bytes: 32768,
      unique: [
        "collection names",
        "field names within each collection",
        "acceptance IDs",
      ],
    },
  };
  const tools = {
    version: TOOL_CONTRACT_VERSION,
    defaultBudget: {
      maxToolCalls: 7,
      maxModelCalls: MAX_MODEL_CALLS,
      maxRepairs: MAX_REPAIR_CALLS,
      maxOutputTokens: MAX_RESERVED_OUTPUT_TOKENS,
      maxInputBytes: 1048576,
    },
    authoritySource:
      "Verified server session, project ownership, source version and fenced execution token; never tool input",
    apiFailureSchema: z.toJSONSchema(toolFailureSchema),
    failureResultSchema: z.toJSONSchema(toolFailureResultSchema),
    runtimeGuards: [
      "Fixed deadline and cancellation",
      "Bound project, source version and task identity",
      "Per-execution call ID replay and conflict checks",
      "Static HTML, AST, capability and byte validation before save or browser checks",
      "Typed bounded tool results",
      "Network and credential isolation for offline browser checks",
    ],
    tools: Object.entries(controlledToolDefinitions).map(
      ([name, definition]) => ({
        name,
        permission: definition.permission,
        modes: definition.modes,
        reserves: {
          modelCalls: definition.modelCalls,
          repairs: definition.repairs,
          outputTokens: definition.outputTokens,
        },
        maxInputBytes: definition.maxInputBytes,
        inputSchema: z.toJSONSchema(definition.inputSchema),
        callSchema: z.toJSONSchema(
          z.strictObject({
            callId: z.uuid().optional(),
            name: z.literal(name),
            input: definition.inputSchema,
          }),
        ),
        dataSchema: z.toJSONSchema(definition.resultSchema),
        resultSchema: z.toJSONSchema(
          z.discriminatedUnion("ok", [
            z.strictObject({
              ok: z.literal(true),
              callId: z.uuid(),
              tool: z.literal(name),
              data: definition.resultSchema,
              budget: toolBudgetSnapshotSchema,
            }),
            toolFailureResultSchema,
          ]),
        ),
      }),
    ),
  };
  await writeFile(
    join(directory, "task-v1.schema.json"),
    JSON.stringify(task, null, 2) + "\n",
  );
  await writeFile(
    join(directory, "tools-v1.json"),
    JSON.stringify(tools, null, 2) + "\n",
  );
  console.log(`Contracts exported: ${directory}`);
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Contract export failed",
  );
  process.exitCode = 1;
});
