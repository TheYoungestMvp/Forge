import { z } from "zod";
import type { AppVersion } from "@/lib/generation/schema";

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  created_at: z.string(),
  updated_at: z.string(),
});

export const messageSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  request_id: z.uuid(),
  seq: z.number().int(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});

export const versionSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  version_number: z.number().int().positive(),
  parent_id: z.uuid().nullable(),
  prompt: z.string().min(1).max(4000),
  title: z.string().min(1).max(120),
  html: z.string().min(1).max(65536),
  css: z.string().max(65536),
  javascript: z.string().min(1).max(65536),
  model: z.string().max(200),
  created_at: z.string(),
});

export const projectSnapshotSchema = z.object({
  project: projectSchema,
  messages: z.array(messageSchema),
  versions: z.array(versionSchema),
});

export const savedGenerationSchema = z.object({
  project: projectSchema,
  version: versionSchema,
  message: messageSchema,
});

export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectMessage = z.infer<typeof messageSchema>;
export type StoredVersion = z.infer<typeof versionSchema>;

export function toAppVersion(version: StoredVersion): AppVersion {
  return {
    id: version.id,
    number: version.version_number,
    parentId: version.parent_id,
    createdAt: version.created_at,
    prompt: version.prompt,
    model: version.model,
    app: {
      title: version.title,
      html: version.html,
      css: version.css,
      javascript: version.javascript,
    },
  };
}
