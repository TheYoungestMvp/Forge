import type { z } from "zod";
import type { projectSnapshotSchema } from "@/lib/projects/schema";

// A saved version is authoritative; the newest uncompleted user request needs recovery.
export function recoverRequest(
  snapshot: z.infer<typeof projectSnapshotSchema>,
) {
  const user = snapshot.messages.findLast((message) => message.role === "user");
  if (
    !user ||
    snapshot.versions.some((version) => version.id === user.request_id)
  )
    return null;
  const message = snapshot.messages.findLast(
    (item) => item.role === "assistant" && item.request_id === user.request_id,
  );
  return {
    id: user.request_id,
    prompt: user.content,
    baseVersionId:
      message?.base_version_id === undefined
        ? (snapshot.versions.at(-1)?.id ?? null)
        : message.base_version_id,
    operation: message?.operation || "generate",
    sourceVersionId: message?.source_version_id ?? null,
    status: message?.status === "processing" ? "processing" : "failed",
    phase: message?.phase ?? 0,
    error:
      message?.content ||
      "The previous request was interrupted. Retry to continue; saved versions are kept.",
  } as const;
}
