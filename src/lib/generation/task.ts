import { z } from "zod";

export const TASK_CONTRACT_VERSION = "1" as const;

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const fieldBase = {
  name: identifier,
  required: z.boolean(),
};
const fieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...fieldBase, type: z.literal("text") }),
  z.strictObject({ ...fieldBase, type: z.literal("number") }),
  z.strictObject({ ...fieldBase, type: z.literal("boolean") }),
  z.strictObject({ ...fieldBase, type: z.literal("date") }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("enum"),
    options: z
      .array(text(80))
      .min(1)
      .max(12)
      .refine(
        (options) => new Set(options).size === options.length,
        "Enum options must be unique",
      ),
  }),
]);

// Tasks describe desired output. Authority, tool access, and resource budgets
// belong to the server-controlled execution contract and are never accepted here.
export const taskSpecSchema = z
  .strictObject({
    version: z.literal(TASK_CONTRACT_VERSION),
    goal: text(4000),
    requirements: z.array(text(4000)).max(16),
    data: z
      .array(
        z.strictObject({
          name: identifier,
          fields: z.array(fieldSchema).min(1).max(16),
        }),
      )
      .max(4),
    preserve: z.array(text(600)).max(16),
    acceptance: z
      .array(
        z.strictObject({
          id: identifier,
          name: text(160),
          action: text(1000),
          expected: text(1000),
          kind: z.enum(["behavior", "regression"]),
        }),
      )
      .max(32),
  })
  .superRefine((task, context) => {
    const collections = new Set<string>();
    for (const [collectionIndex, collection] of task.data.entries()) {
      if (collections.has(collection.name)) {
        context.addIssue({
          code: "custom",
          path: ["data", collectionIndex, "name"],
          message: "Collection names must be unique",
        });
      }
      collections.add(collection.name);

      const fields = new Set<string>();
      for (const [fieldIndex, field] of collection.fields.entries()) {
        if (fields.has(field.name)) {
          context.addIssue({
            code: "custom",
            path: ["data", collectionIndex, "fields", fieldIndex, "name"],
            message: "Field names must be unique within a collection",
          });
        }
        fields.add(field.name);
      }
    }

    const acceptanceIds = new Set<string>();
    for (const [index, criterion] of task.acceptance.entries()) {
      if (acceptanceIds.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          path: ["acceptance", index, "id"],
          message: "Acceptance criterion IDs must be unique",
        });
      }
      acceptanceIds.add(criterion.id);
    }

    if (new TextEncoder().encode(JSON.stringify(task)).byteLength > 32768) {
      context.addIssue({
        code: "custom",
        message: "Task must fit within 32768 UTF-8 bytes",
      });
    }
  });

export type TaskSpec = z.infer<typeof taskSpecSchema>;

export function resolveTaskSpec(prompt: string, task?: TaskSpec): TaskSpec {
  return taskSpecSchema.parse(
    task ?? {
      version: TASK_CONTRACT_VERSION,
      goal: prompt,
      requirements: [prompt],
      data: [],
      preserve: [
        "Preserve all existing working features unless the request explicitly changes them.",
      ],
      acceptance: [],
    },
  );
}

export function canonicalTask(task: TaskSpec): string {
  return JSON.stringify(taskSpecSchema.parse(task));
}
