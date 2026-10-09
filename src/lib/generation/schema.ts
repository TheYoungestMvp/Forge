import { z } from "zod";
import { messageSchema, savedGenerationSchema } from "@/lib/projects/schema";

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
  currentApp: generatedAppSchema.optional(),
  projectId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  baseVersionId: z.uuid().nullable().optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export type AppVersion = {
  id: string;
  number: number;
  parentId: string | null;
  createdAt: string;
  prompt: string;
  model: string;
  app: GeneratedApp;
};

export const generationEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("status"),
    step: z.number().int().min(0).max(4),
  }),
  z.strictObject({
    type: z.literal("complete"),
    saved: savedGenerationSchema,
  }),
  z.strictObject({
    type: z.literal("message"),
    message: messageSchema,
  }),
  z.strictObject({
    type: z.literal("error"),
    code: z.string().max(80),
    message: z.string().max(600),
  }),
]);

export type GenerationEvent = z.infer<typeof generationEventSchema>;
