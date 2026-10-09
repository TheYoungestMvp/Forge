import { z } from "zod";

const code = z.string().max(65536);

export const generatedAppSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  html: code.refine(
    (value) => value.trim().length > 0,
    "HTML must not be empty",
  ),
  css: code,
  javascript: code.refine(
    (value) => value.trim().length > 0,
    "JavaScript must provide real interaction",
  ),
});

export type GeneratedApp = z.infer<typeof generatedAppSchema>;

// Kept deliberately basic for providers supporting the strict JSON Schema subset.
export const appJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    html: { type: "string" },
    css: { type: "string" },
    javascript: { type: "string" },
  },
  required: ["title", "html", "css", "javascript"],
  additionalProperties: false,
} as const;

export const generateRequestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(4000),
});

export const generationEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("status"),
    step: z.number().int().min(0).max(3),
  }),
  z.strictObject({
    type: z.literal("complete"),
    app: generatedAppSchema,
    model: z.string().max(200),
  }),
  z.strictObject({
    type: z.literal("error"),
    code: z.string().max(80),
    message: z.string().max(600),
  }),
]);

export type GenerationEvent = z.infer<typeof generationEventSchema>;
