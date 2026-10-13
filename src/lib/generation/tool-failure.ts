import { z } from "zod";

export const toolErrorSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(600),
  status: z.number().int().min(400).max(599),
  recovery: z.enum(["none", "retry_request", "repair_output", "reload_state"]),
  outcome: z.enum(["not_started", "failed", "unknown"]),
});
export const toolFailureSchema = toolErrorSchema.extend({
  tool: z.string().min(1).max(40),
  callId: z.uuid().nullable(),
});
export type ToolError = z.infer<typeof toolErrorSchema>;
export type ToolFailure = z.infer<typeof toolFailureSchema>;

const count = z.number().int().nonnegative();
const counters = z.strictObject({
  toolCalls: count,
  modelCalls: count,
  repairs: count,
  outputTokens: count,
});
export const toolBudgetSnapshotSchema = z.strictObject({
  limits: z.strictObject({
    maxToolCalls: count,
    maxModelCalls: count,
    maxRepairs: count,
    maxOutputTokens: count,
    maxInputBytes: count,
  }),
  used: counters,
  remaining: counters,
});
export const toolFailureResultSchema = z.strictObject({
  ok: z.literal(false),
  callId: z.uuid().nullable(),
  tool: z.string().min(1).max(40),
  error: toolErrorSchema,
  budget: toolBudgetSnapshotSchema,
});
