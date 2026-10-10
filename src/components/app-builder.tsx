"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Compass,
  History,
  Layers2,
  LoaderCircle,
  MessageSquare,
  Monitor,
  PanelLeft,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trash2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import {
  generationEventSchema,
  pendingGenerationSchema,
  type AppVersion,
  type GeneratedApp,
} from "@/lib/generation/schema";
import { composePreview } from "@/lib/preview/compose";
import { workspaceStatus } from "@/lib/preview/status";
import { projectLabel } from "@/lib/projects/label";
import { GenerationField } from "@/components/generation-field";
import { AppReadyMoment } from "@/components/app-ready-moment";
import { ProjectControls } from "@/components/project-controls";
import { recoverRequest } from "@/lib/generation/recovery";
import {
  projectSchema,
  projectSnapshotSchema,
  restoredVersionSchema,
  toAppVersion,
  type Project,
  type ProjectMessage,
} from "@/lib/projects/schema";

const steps = [
  "Understanding requirements",
  "Planning application",
  "Generating code",
  "Validating application",
  "Saving version",
  "Completed",
];
const examples = [
  {
    label: "Todo App",
    prompt:
      "Build a minimal todo app with adding, deleting and completing tasks.",
  },
  {
    label: "Calculator",
    prompt:
      "Build a minimal calculator with adding, subtracting, multiplying, dividing, decimals and clearing the result.",
  },
  {
    label: "Habit Tracker",
    prompt:
      "Build a minimal habit tracker with adding and deleting habits, marking habits completed today and showing progress.",
  },
];
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  saved: boolean;
  plan?: string[];
};
type Preview = {
  versionId: string;
  app: GeneratedApp;
  srcDoc: string;
  token: string;
  versionNumber: number;
};

function versionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

async function projectJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.error?.message === "string"
        ? body.error.message
        : "Project storage could not complete the request. Please retry.",
    );
  return body;
}

function projectUrl(id: string | null, replace = false) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("project", id);
  else url.searchParams.delete("project");
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
}

function ExampleArtwork({ kind }: { kind: string }) {
  return (
    <svg className="example-artwork" viewBox="0 0 72 72" aria-hidden="true">
      {kind === "Todo App" ? (
        <>
          <rect x="12" y="10" width="48" height="52" rx="4" />
          {[24, 36, 48].map((y, index) => (
            <g key={y}>
              <rect x="20" y={y - 4} width="8" height="8" rx="2" />
              {index === 0 && <path d="m21 24 2 2 4-4" />}
              <path d={`M34 ${y}h${index === 1 ? 12 : 18}`} />
            </g>
          ))}
        </>
      ) : kind === "Calculator" ? (
        <>
          <rect x="16" y="8" width="40" height="56" rx="4" />
          <rect x="23" y="16" width="26" height="12" rx="2" />
          {[35, 45, 55].map((y) =>
            [25, 36, 47].map((x) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />
            )),
          )}
        </>
      ) : (
        <>
          <rect x="10" y="14" width="52" height="46" rx="4" />
          <path d="M10 26h52M23 10v8M49 10v8" />
          {[33, 43, 53].map((y) =>
            [20, 31, 42, 53].map((x, index) => (
              <rect
                key={`${x}-${y}`}
                x={x - 2}
                y={y - 2}
                width="4"
                height="4"
                rx="1"
                className={index < 2 ? "example-cell-filled" : ""}
              />
            )),
          )}
        </>
      )}
    </svg>
  );
}

export function AppBuilder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [recoveringRequestId, setRecoveringRequestId] = useState<string | null>(
    null,
  );
  const [storageError, setStorageError] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null,
  );
  const isRestoring = restoringVersionId !== null;
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [freshVersionId, setFreshVersionId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "preview">("chat");
  const [reloadKey, setReloadKey] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const previewTokenRef = useRef<string | null>(null);
  const previewSettledRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const followChatRef = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const projectRequestRef = useRef<AbortController | null>(null);
  const loadTargetRef = useRef<string | null>(null);
  const displayedProjectIdRef = useRef<string | null>(null);
  const lastAttemptRef = useRef<{
    id: string;
    projectId: string;
    prompt: string;
    baseVersionId: string | null;
  } | null>(null);
  const restoreAttemptRef = useRef<{
    id: string;
    projectId: string;
    versionId: string;
    baseVersionId: string;
  } | null>(null);
  const inputDisabled =
    isRunning ||
    isRestoring ||
    isDeleting ||
    projectLoading ||
    Boolean(recoveringRequestId);
  const latestVersion = versions.at(-1);
  const isHistorical = Boolean(
    preview && latestVersion && preview.versionId !== latestVersion.id,
  );
  const generationDisabled = inputDisabled || isHistorical;
  const hasStarted = messages.length > 0 || Boolean(preview);
  const status = workspaceStatus({
    generating: isRunning,
    restoring: isRestoring,
    generationError,
    previewError,
    hasPreview: Boolean(preview),
    previewReady,
  });
  const workHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasStartedRef = useRef(false);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (deleteTarget && dialog && !dialog.open) {
      dialog.showModal();
      deleteCancelRef.current?.focus();
    } else if (!deleteTarget && dialog?.open) {
      dialog.close();
    }
  }, [deleteTarget]);

  const showVersion = useCallback((version: AppVersion) => {
    setFreshVersionId(null);
    const token = crypto.randomUUID();
    previewTokenRef.current = token;
    previewSettledRef.current = false;
    setPreviewReady(false);
    setPreviewError(null);
    setPreview({
      versionId: version.id,
      app: version.app,
      srcDoc: composePreview(version.app, token),
      token,
      versionNumber: version.number,
    });
  }, []);

  const clearWorkspace = useCallback(() => {
    followChatRef.current = true;
    previewTokenRef.current = null;
    previewSettledRef.current = false;
    lastAttemptRef.current = null;
    restoreAttemptRef.current = null;
    setRestoreError(null);
    setRecoveringRequestId(null);
    setIsRunning(false);
    setRestoringVersionId(null);
    setPreview(null);
    setFreshVersionId(null);
    setVersions([]);
    setPreviewReady(false);
    setPreviewError(null);
    setGenerationError(null);
    setActiveStep(-1);
    setMessages([]);
    setPrompt("");
    setLastPrompt("");
    setWorkspaceTab("chat");
  }, []);

  const loadWorkspace = useCallback(
    async (id: string | null, replaceUrl = true) => {
      deleteDialogRef.current?.close();
      setProjectNotice(null);
      projectRequestRef.current?.abort();
      const controller = new AbortController();
      projectRequestRef.current = controller;
      loadTargetRef.current = id;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 65000);
      setProjectLoading(true);
      setStorageError(null);
      try {
        await projectJson(
          await fetch("/api/session", {
            method: "POST",
            signal: controller.signal,
          }),
        );
        const list = z.array(projectSchema).parse(
          await projectJson(
            await fetch("/api/projects", {
              cache: "no-store",
              signal: controller.signal,
            }),
          ),
        );
        controller.signal.throwIfAborted();
        setProjects(list);
        if (id) {
          const snapshot = projectSnapshotSchema.parse(
            await projectJson(
              await fetch(`/api/projects/${encodeURIComponent(id)}`, {
                cache: "no-store",
                signal: controller.signal,
              }),
            ),
          );
          controller.signal.throwIfAborted();
          clearWorkspace();
          setProject(snapshot.project);
          displayedProjectIdRef.current = snapshot.project.id;
          setMessages(
            snapshot.messages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              saved: true,
              plan: message.plan,
            })),
          );
          const storedVersions = snapshot.versions.map(toAppVersion);
          setVersions(storedVersions);
          const latest = storedVersions.at(-1);
          if (latest) {
            showVersion(latest);
            setActiveStep(5);
          }
          const lastUser = snapshot.messages.findLast(
            (message) => message.role === "user",
          );
          if (lastUser) setLastPrompt(lastUser.content);
          const recovered = recoverRequest(snapshot);
          if (recovered) {
            setActiveStep(recovered.phase);
            if (
              recovered.operation === "restore" &&
              recovered.sourceVersionId &&
              recovered.baseVersionId
            ) {
              restoreAttemptRef.current = {
                id: recovered.id,
                projectId: id,
                versionId: recovered.sourceVersionId,
                baseVersionId: recovered.baseVersionId,
              };
              if (recovered.status === "processing")
                setRestoringVersionId(recovered.sourceVersionId);
              else setRestoreError(recovered.error);
            } else {
              lastAttemptRef.current = {
                id: recovered.id,
                projectId: id,
                prompt: recovered.prompt,
                baseVersionId: recovered.baseVersionId,
              };
              if (recovered.status === "processing") setIsRunning(true);
              else setGenerationError(recovered.error);
            }
            if (recovered.status === "processing")
              setRecoveringRequestId(recovered.id);
          }
          projectUrl(id, replaceUrl);
        } else {
          clearWorkspace();
          setProject(null);
          displayedProjectIdRef.current = null;
          projectUrl(null, true);
        }
      } catch (error) {
        if (
          projectRequestRef.current === controller &&
          (timedOut || !controller.signal.aborted)
        ) {
          projectUrl(displayedProjectIdRef.current, true);
          setStorageError(
            timedOut
              ? "Loading projects timed out. Check your connection and retry."
              : error instanceof Error
                ? error.message
                : "Could not load your project. Please retry.",
          );
        }
      } finally {
        clearTimeout(timer);
        if (projectRequestRef.current === controller) {
          projectRequestRef.current = null;
          setProjectLoading(false);
        }
      }
    },
    [clearWorkspace, showVersion],
  );

  useEffect(() => {
    const load = () => {
      requestRef.current?.abort();
      requestRef.current = null;
      setIsRunning(false);
      setRestoringVersionId(null);
      void loadWorkspace(
        new URL(window.location.href).searchParams.get("project"),
      );
    };
    load();
    window.addEventListener("popstate", load);
    return () => {
      window.removeEventListener("popstate", load);
      projectRequestRef.current?.abort();
    };
  }, [loadWorkspace]);

  useEffect(() => {
    if (!recoveringRequestId || !project) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const snapshot = projectSnapshotSchema.parse(
          await projectJson(
            await fetch(`/api/projects/${project!.id}?view=status`, {
              cache: "no-store",
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(35000),
              ]),
            }),
          ),
        );
        if (controller.signal.aborted) return;
        const message = snapshot.messages.find(
          (item) =>
            item.request_id === recoveringRequestId &&
            item.role === "assistant",
        );
        setMessages(
          snapshot.messages.map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            saved: true,
            plan: item.plan,
          })),
        );
        if (message?.status === "processing") {
          setActiveStep(message.phase ?? 0);
          timer = setTimeout(() => void poll(), 2000);
        } else {
          setRecoveringRequestId(null);
          setIsRunning(false);
          setRestoringVersionId(null);
          void loadWorkspace(project!.id);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRecoveringRequestId(null);
          setIsRunning(false);
          setRestoringVersionId(null);
          setStorageError(
            error instanceof Error
              ? error.message
              : "Could not recover the running request. Retry loading to check its saved result.",
          );
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [recoveringRequestId, project, loadWorkspace]);

  useEffect(() => {
    if (hasStarted && !wasStartedRef.current) workHeadingRef.current?.focus();
    if (!hasStarted && wasStartedRef.current) promptRef.current?.focus();
    wasStartedRef.current = hasStarted;
  }, [hasStarted]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        data.channel !== "forge-preview" ||
        data.token !== previewTokenRef.current
      )
        return;
      if (data.type === "ready") {
        previewSettledRef.current = true;
        setPreviewReady(true);
      }
      if (
        data.type === "error" &&
        typeof data.message === "string" &&
        data.message.length <= 400
      ) {
        previewSettledRef.current = true;
        setPreviewReady(false);
        setPreviewError(
          data.message || "The application encountered a runtime error.",
        );
      }
    }
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => {
      if (!previewSettledRef.current)
        setPreviewError(
          "The preview did not finish loading. Try reloading it.",
        );
    }, 5000);
    return () => clearTimeout(timer);
  }, [preview, reloadKey]);

  useEffect(() => {
    const chat = chatScrollRef.current;
    if (
      chat &&
      (followChatRef.current || generationError) &&
      (messages.length || isRunning)
    ) {
      chat.scrollTo({ top: chat.scrollHeight, behavior: "auto" });
    }
  }, [
    messages,
    isRunning,
    generationError,
    activeStep,
    workspaceTab,
    previewReady,
  ]);

  function mergeMessage(message: ProjectMessage) {
    const next: Message = {
      id: message.id,
      role: message.role,
      content: message.content,
      saved: true,
      plan: message.plan,
    };
    setMessages((previous) => {
      const retained = previous.filter(
        (item) => item.id !== `local-error:${message.request_id}`,
      );
      return retained.some((item) => item.id === next.id)
        ? retained.map((item) => (item.id === next.id ? next : item))
        : [...retained, next];
    });
  }

  async function createProjectRecord(signal?: AbortSignal) {
    return projectSchema.parse(
      await projectJson(
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: projectName.trim() || "Untitled project",
          }),
          signal,
        }),
      ),
    );
  }

  async function createNamedProject() {
    if (inputDisabled || projectRequestRef.current) return;
    const controller = new AbortController();
    projectRequestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35000);
    setProjectLoading(true);
    setStorageError(null);
    setProjectNotice(null);
    try {
      const created = await createProjectRecord(controller.signal);
      controller.signal.throwIfAborted();
      clearWorkspace();
      setProject(created);
      displayedProjectIdRef.current = created.id;
      setProjects((previous) => [created, ...previous]);
      setProjectName("");
      projectUrl(created.id);
      loadTargetRef.current = created.id;
      promptRef.current?.focus();
    } catch (error) {
      if (
        projectRequestRef.current === controller &&
        (timedOut || !controller.signal.aborted)
      )
        setStorageError(
          timedOut
            ? "Creating the project timed out. Reload projects to check whether it was saved before trying again."
            : error instanceof Error
              ? error.message
              : "Could not create the project. Please retry.",
        );
    } finally {
      clearTimeout(timer);
      if (projectRequestRef.current === controller) {
        projectRequestRef.current = null;
        setProjectLoading(false);
      }
    }
  }

  async function submitPrompt(value = prompt, retry = false) {
    const content = value.trim();
    if (
      !content ||
      generationDisabled ||
      requestRef.current ||
      content.length > 4000
    )
      return;
    const controller = new AbortController();
    followChatRef.current = true;
    requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 140000);
    setGenerationError(null);
    setRestoreError(null);
    setStorageError(null);
    setActiveStep(0);
    setFreshVersionId(null);
    setIsRunning(true);
    let completed = false;
    let failureSaved = false;
    let errorCode = "";
    let attempt: typeof lastAttemptRef.current = null;
    try {
      const currentProject =
        project || (await createProjectRecord(controller.signal));
      if (requestRef.current !== controller) return;
      if (!project) {
        setProject(currentProject);
        displayedProjectIdRef.current = currentProject.id;
        setProjects((previous) => [currentProject, ...previous]);
        setProjectName("");
        projectUrl(currentProject.id, true);
        loadTargetRef.current = currentProject.id;
      }
      attempt =
        retry &&
        lastAttemptRef.current?.projectId === currentProject.id &&
        lastAttemptRef.current.prompt === content
          ? lastAttemptRef.current
          : {
              id: crypto.randomUUID(),
              projectId: currentProject.id,
              prompt: content,
              baseVersionId: versions.at(-1)?.id ?? null,
            };
      lastAttemptRef.current = attempt;
      const userMessage: Message = {
        id: attempt.id,
        role: "user",
        content,
        saved: false,
      };
      setMessages((previous) =>
        previous.some((item) => item.id === userMessage.id)
          ? previous
          : [...previous, userMessage],
      );
      setLastPrompt(content);
      setPrompt("");
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          projectId: currentProject.id,
          requestId: attempt.id,
          baseVersionId: attempt.baseVersionId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        errorCode =
          typeof failure?.error?.code === "string" ? failure.error.code : "";
        throw new Error(
          typeof failure?.error?.message === "string"
            ? failure.error.message
            : "Generation failed. Please try again.",
        );
      }
      if (response.status === 202) {
        const pending = pendingGenerationSchema.parse(await response.json());
        mergeMessage(pending.userMessage);
        mergeMessage(pending.message);
        setActiveStep(pending.message.phase ?? 0);
        setRecoveringRequestId(pending.message.request_id);
        requestRef.current = null;
        return;
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("application/x-ndjson")
      )
        throw new Error(
          "The server returned an unexpected generation response.",
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      function receive(line: string) {
        if (!line.trim()) return;
        let data: unknown;
        try {
          data = JSON.parse(line);
        } catch {
          throw new Error(
            "The server returned an invalid generation response.",
          );
        }
        const result = generationEventSchema.safeParse(data);
        if (!result.success)
          throw new Error(
            "The server returned an invalid generation response.",
          );
        const event = result.data;
        if (requestRef.current !== controller) return;
        if (event.type === "status") setActiveStep(event.step);
        if (event.type === "message") {
          mergeMessage(event.message);
          if (
            event.message.role === "assistant" &&
            event.message.status === "failed"
          )
            failureSaved = true;
        }
        if (event.type === "error") {
          errorCode = event.code;
          throw new Error(event.message);
        }
        if (event.type === "complete") {
          const version = toAppVersion(event.saved.version);
          setVersions((previous) =>
            [
              ...previous.filter((item) => item.id !== version.id),
              version,
            ].sort((a, b) => a.number - b.number),
          );
          setProject(event.saved.project);
          setProjects((previous) => [
            event.saved.project,
            ...previous.filter((item) => item.id !== event.saved.project.id),
          ]);
          mergeMessage(event.saved.message);
          showVersion(version);
          setFreshVersionId(version.id);
          setActiveStep(5);
          completed = true;
        }
      }
      try {
        while (!completed) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          if (buffer.length > 1024 * 1024)
            throw new Error("The generation response is too large.");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            receive(line);
            if (completed) break;
          }
          if (chunk.done) {
            if (!completed && buffer.trim()) receive(buffer);
            break;
          }
        }
        if (!completed)
          throw new Error(
            "Generation ended before an application was returned. Please retry.",
          );
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (error) {
      if (requestRef.current !== controller) return;
      const message = controller.signal.aborted
        ? "The generation request was interrupted or timed out. Please retry."
        : error instanceof Error
          ? error.message
          : "Generation failed. Please try again.";
      setGenerationError(message);
      if (
        !attempt ||
        errorCode.startsWith("DATABASE_") ||
        ["PROJECT_CHANGED", "PROJECT_NOT_FOUND"].includes(errorCode)
      )
        setStorageError(message);
      if (attempt && !failureSaved) {
        const localErrorId = `local-error:${attempt.id}`;
        setMessages((previous) => [
          ...previous.filter((item) => item.id !== localErrorId),
          {
            id: localErrorId,
            role: "assistant",
            content: message,
            saved: false,
          },
        ]);
      }
    } finally {
      clearTimeout(timer);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsRunning(false);
      }
    }
  }

  async function deleteProject() {
    if (!deleteTarget || inputDisabled || projectRequestRef.current) return;
    const target = deleteTarget;
    const controller = new AbortController();
    projectRequestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35000);
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(target.id)}`,
        {
          method: "DELETE",
          signal: controller.signal,
        },
      );
      if (!response.ok) await projectJson(response);
      controller.signal.throwIfAborted();
      setProjects((previous) =>
        previous.filter((item) => item.id !== target.id),
      );
      if (displayedProjectIdRef.current === target.id) {
        clearWorkspace();
        setProject(null);
        displayedProjectIdRef.current = null;
        loadTargetRef.current = null;
        setProjectName("");
        setStorageError(null);
        projectUrl(null, true);
      }
      setDeleteTarget(null);
      setProjectNotice(`“${target.name}” was deleted.`);
      requestAnimationFrame(() => promptRef.current?.focus());
    } catch (error) {
      if (
        projectRequestRef.current === controller &&
        (timedOut || !controller.signal.aborted)
      )
        setDeleteError(
          timedOut
            ? "Deletion could not be confirmed. Cancel and reload projects to check before retrying."
            : error instanceof Error
              ? error.message
              : "Could not delete the project. Please retry.",
        );
    } finally {
      clearTimeout(timer);
      if (projectRequestRef.current === controller)
        projectRequestRef.current = null;
      setIsDeleting(false);
    }
  }

  function startNewApp() {
    if (inputDisabled) return;
    clearWorkspace();
    setProject(null);
    displayedProjectIdRef.current = null;
    setProjectName("");
    setStorageError(null);
    setProjectNotice(null);
    loadTargetRef.current = null;
    projectUrl(null);
  }

  function reloadPreview() {
    setFreshVersionId(null);
    previewSettledRef.current = false;
    setPreviewReady(false);
    setPreviewError(null);
    setReloadKey((previous) => previous + 1);
  }

  function previewVersion(version: AppVersion) {
    if (inputDisabled) return;
    setRestoreError(null);
    showVersion(version);
    setWorkspaceTab("preview");
  }

  async function restoreVersion(version: AppVersion, retry = false) {
    if (!project || !latestVersion || inputDisabled || requestRef.current)
      return;
    const controller = new AbortController();
    requestRef.current = controller;
    const attempt =
      retry &&
      restoreAttemptRef.current?.projectId === project.id &&
      restoreAttemptRef.current.versionId === version.id
        ? restoreAttemptRef.current
        : {
            id: crypto.randomUUID(),
            projectId: project.id,
            versionId: version.id,
            baseVersionId: latestVersion.id,
          };
    restoreAttemptRef.current = attempt;
    setRestoringVersionId(version.id);
    setRestoreError(null);
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`/api/projects/${project.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: attempt.versionId,
          requestId: attempt.id,
          baseVersionId: attempt.baseVersionId,
        }),
        signal: controller.signal,
      });
      if (response.status === 202) {
        const pending = pendingGenerationSchema.parse(await response.json());
        mergeMessage(pending.userMessage);
        mergeMessage(pending.message);
        setRecoveringRequestId(pending.message.request_id);
        requestRef.current = null;
        return;
      }
      const saved = restoredVersionSchema.parse(await projectJson(response));
      if (requestRef.current !== controller) return;
      const next = toAppVersion(saved.version);
      setVersions((previous) =>
        [...previous.filter((item) => item.id !== next.id), next].sort(
          (a, b) => a.number - b.number,
        ),
      );
      setProject(saved.project);
      setProjects((previous) => [
        saved.project,
        ...previous.filter((item) => item.id !== saved.project.id),
      ]);
      mergeMessage(saved.userMessage);
      mergeMessage(saved.message);
      setGenerationError(null);
      setStorageError(null);
      setActiveStep(5);
      setLastPrompt("");
      lastAttemptRef.current = null;
      restoreAttemptRef.current = null;
      showVersion(next);
      setWorkspaceTab("preview");
    } catch (error) {
      if (requestRef.current !== controller) return;
      setRestoreError(
        controller.signal.aborted
          ? "Restore was interrupted or timed out. Retry to recover any saved result."
          : error instanceof Error
            ? error.message
            : "Could not restore this version. Please retry.",
      );
    } finally {
      clearTimeout(timer);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setRestoringVersionId(null);
      }
    }
  }

  const progressSteps = (
    <ol>
      {steps.map((label, index) => {
        const done =
          index < activeStep ||
          (activeStep === 5 && index === 5 && !isRunning && !generationError);
        const current = isRunning && index === activeStep;
        const failed = Boolean(generationError) && index === activeStep;
        return (
          <li
            key={label}
            className={
              failed
                ? "step-failed"
                : done
                  ? "step-done"
                  : current
                    ? "step-active"
                    : "step-pending"
            }
            aria-current={current ? "step" : undefined}
          >
            <span className="step-icon">
              {failed ? (
                <XCircle size={12} />
              ) : done ? (
                <Check size={12} strokeWidth={2.5} />
              ) : current ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <Circle size={7} />
              )}
            </span>
            <span>{label}</span>
            {current && <span className="step-working">Working</span>}
            {index === 5 && done && (
              <span className="step-working">Ready to explore</span>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div
      className={`builder-shell ${hasStarted ? "builder-working" : "builder-start"}`}
    >
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Forge home">
          <span className="brand-mark">
            <Layers2 size={19} strokeWidth={2.3} />
          </span>
          <span>
            forge<span className="brand-dot">.</span>
          </span>
        </Link>
        <span className="header-divider" />
        <div className="project-heading">
          <span className="project-icon">
            <Compass size={15} />
          </span>
          <span
            className="project-name"
            title={project ? projectLabel(project) : "New project"}
          >
            {project ? projectLabel(project) : "New project"}
          </span>
          <span className="project-label">Project</span>
        </div>
        <div className="header-right">
          <span className="workspace-note">
            <span className="status-dot" />
            {projectLoading
              ? "Loading projects…"
              : isDeleting
                ? "Deleting project…"
                : isRestoring
                  ? "Saving restored version…"
                  : isRunning
                    ? "Saving as you build"
                    : storageError
                      ? "Storage unavailable"
                      : project
                        ? "Saved"
                        : "Ready to create"}
          </span>
          {(hasStarted || project) && (
            <button
              type="button"
              className="new-app-button"
              disabled={inputDisabled}
              onClick={startNewApp}
            >
              <Plus size={12} /> New project
            </button>
          )}
          <span className="avatar" aria-label="Demo user">
            Y
          </span>
        </div>
      </header>
      <ProjectControls
        key={hasStarted ? "working" : "entry"}
        working={hasStarted}
      >
        <div className="project-toolbar" aria-label="Project controls">
          <div className="project-picker">
            <label htmlFor="saved-project">Open project</label>
            <select
              id="saved-project"
              value={project?.id || ""}
              disabled={inputDisabled}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) {
                  startNewApp();
                  return;
                }
                void loadWorkspace(id, false);
              }}
            >
              <option value="">Choose a saved project</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {projectLabel(item)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="Reload projects"
              disabled={inputDisabled}
              onClick={() =>
                void loadWorkspace(project?.id || loadTargetRef.current)
              }
            >
              <RotateCcw size={15} />
            </button>
            <button
              ref={deleteButtonRef}
              type="button"
              className="project-delete-button"
              disabled={!project || inputDisabled}
              onClick={() => {
                setDeleteError(null);
                setDeleteTarget(project);
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete project
            </button>
          </div>
          <form
            className="project-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createNamedProject();
            }}
          >
            <label htmlFor="project-name" className="sr-only">
              New project name
            </label>
            <input
              id="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              maxLength={120}
              placeholder="Name a new project"
              disabled={inputDisabled}
            />
            <button
              type="submit"
              className="new-app-button"
              disabled={inputDisabled}
            >
              <Plus size={14} /> Create project
            </button>
          </form>
        </div>
      </ProjectControls>
      {storageError && (
        <div className="storage-error" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>Project storage needs attention</strong>
            <p>{storageError}</p>
          </div>
          <button
            type="button"
            disabled={inputDisabled}
            onClick={() =>
              void loadWorkspace(loadTargetRef.current || project?.id || null)
            }
          >
            Retry loading
          </button>
        </div>
      )}
      {projectLoading && (
        <p className="project-loading" role="status">
          <LoaderCircle size={16} className="animate-spin" /> Loading saved
          projects and conversation…
        </p>
      )}
      {hasStarted && (
        <div className="workspace-topline">
          <div>
            <h1 ref={workHeadingRef} tabIndex={-1}>
              Ideas become interfaces<span>.</span>
            </h1>
          </div>
        </div>
      )}
      {hasStarted && (
        <div className="mobile-workspace-tabs" aria-label="Workspace panels">
          <button
            type="button"
            aria-pressed={workspaceTab === "chat"}
            onClick={() => setWorkspaceTab("chat")}
          >
            <MessageSquare size={15} />
            Agent Chat
          </button>
          <button
            type="button"
            aria-pressed={workspaceTab === "preview"}
            onClick={() => setWorkspaceTab("preview")}
          >
            <Monitor size={15} />
            Preview
            {previewError && (
              <span className="workspace-tab-error">
                <AlertCircle size={14} aria-hidden="true" /> Error
              </span>
            )}
          </button>
        </div>
      )}
      {projectNotice && (
        <p className="project-notice" role="status">
          {projectNotice}
        </p>
      )}
      <dialog
        ref={deleteDialogRef}
        className="delete-project-dialog"
        aria-labelledby="delete-project-title"
        aria-describedby="delete-project-name delete-project-description"
        aria-busy={isDeleting}
        onCancel={(event) => {
          if (isDeleting) event.preventDefault();
        }}
        onClose={() => {
          setDeleteTarget(null);
          if (displayedProjectIdRef.current) deleteButtonRef.current?.focus();
        }}
      >
        <h2 id="delete-project-title">Delete project?</h2>
        <p id="delete-project-name" className="delete-project-name">
          {deleteTarget && projectLabel(deleteTarget)}
        </p>
        <p id="delete-project-description">
          This permanently deletes this project, its chat and all saved
          versions. This cannot be undone.
        </p>
        {deleteError && (
          <p className="delete-project-error" role="alert">
            {deleteError}
          </p>
        )}
        <div className="delete-project-actions">
          <button
            ref={deleteCancelRef}
            type="button"
            disabled={isDeleting}
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete-button"
            disabled={isDeleting}
            onClick={() => void deleteProject()}
          >
            {isDeleting && (
              <LoaderCircle
                size={16}
                className="animate-spin"
                aria-hidden="true"
              />
            )}
            {isDeleting ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </dialog>
      <main
        className={`workspace ${hasStarted ? "workspace-working" : "workspace-start"}`}
      >
        <section
          className={`chat-panel ${workspaceTab === "chat" ? "mobile-visible" : ""}`}
          aria-label="Agent Chat"
        >
          {hasStarted && (
            <div className="panel-header">
              <div className="panel-title">
                <span className="agent-symbol">
                  <Sparkles size={15} />
                </span>
                <h2>Agent Chat</h2>
                <span className="agent-status" data-state={status.tone}>
                  {status.label}
                </span>
              </div>
              <PanelLeft size={16} className="muted-icon" aria-hidden="true" />
            </div>
          )}
          {!hasStarted && (
            <div className="start-intro">
              <div className="start-signal">
                <GenerationField
                  variant="entry"
                  activity={isRunning ? "working" : "idle"}
                  phase={Math.max(activeStep, 0)}
                  engagement={
                    Math.min(prompt.length / 140, 1) * 0.55 +
                    (composerFocused ? 0.45 : 0)
                  }
                />
                <span className="start-mark" aria-hidden="true">
                  <Layers2 size={28} strokeWidth={1.8} />
                </span>
              </div>
              <h1>
                Ideas become interfaces<span>.</span>
              </h1>
              <p>Describe your idea. Then refine it step by step.</p>
            </div>
          )}
          {hasStarted && (
            <div
              className="chat-scroll"
              ref={chatScrollRef}
              onScroll={(event) => {
                const chat = event.currentTarget;
                followChatRef.current =
                  chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 48;
              }}
            >
              <div
                className="messages"
                role="log"
                aria-label="Conversation"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message message-${message.role}`}
                  >
                    <div className="message-author">
                      {message.role === "assistant" ? (
                        <span className="message-agent-icon">
                          <Sparkles size={12} />
                        </span>
                      ) : (
                        <span className="message-user-icon">Y</span>
                      )}
                      <span>
                        {message.role === "assistant" ? "Forge Agent" : "You"}
                      </span>
                      {message.role === "assistant" && (
                        <span className="message-label">AI</span>
                      )}
                      {!message.saved && (
                        <span className="message-label">
                          {isRunning ? "Saving…" : "Not saved"}
                        </span>
                      )}
                    </div>
                    <p>{message.content}</p>
                    {Boolean(message.plan?.length) && (
                      <ol
                        className="message-plan"
                        aria-label="Implementation plan"
                      >
                        {message.plan!.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </article>
                ))}
              </div>
              <div
                className="progress-card"
                aria-label="Agent progress"
                aria-busy={isRunning || isRestoring}
                data-state={
                  isRunning || isRestoring
                    ? "working"
                    : generationError || previewError
                      ? "failed"
                      : preview
                        ? "complete"
                        : "idle"
                }
              >
                <p className="sr-only" role="status">
                  {isRunning ? steps[activeStep] : status.announcement}
                </p>
                {preview &&
                previewReady &&
                !previewError &&
                !isRunning &&
                !isRestoring &&
                !generationError &&
                !isHistorical ? (
                  <AppReadyMoment
                    key={preview.versionId}
                    title={preview.app.title}
                    versionNumber={preview.versionNumber}
                    fresh={freshVersionId === preview.versionId}
                  />
                ) : (
                  <div className="progress-heading">
                    <span>
                      <WandSparkles size={13} />
                      {status.heading}
                    </span>
                    <span className="progress-caption">
                      {preview
                        ? isRunning
                          ? `Creating v${versions.length + 1}`
                          : `v${preview.versionNumber}`
                        : "First generation"}
                    </span>
                  </div>
                )}
                {activeStep >= 0 &&
                  (isRunning ? (
                    progressSteps
                  ) : (
                    <details className="progress-details">
                      <summary>
                        {generationError
                          ? "View failed generation"
                          : "View generation steps"}
                        <ChevronDown size={13} />
                      </summary>
                      {progressSteps}
                    </details>
                  ))}
              </div>
              {generationError && (
                <div className="generation-error" role="alert">
                  <AlertCircle size={15} />
                  <div>
                    <strong>Generation failed</strong>
                    <p>{generationError}</p>
                    <button
                      type="button"
                      disabled={generationDisabled}
                      onClick={() => void submitPrompt(lastPrompt, true)}
                    >
                      Retry generation
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <form
            className="composer-area"
            onFocusCapture={() => setComposerFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setComposerFocused(false);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt();
            }}
          >
            <div className={`composer ${isRunning ? "composer-busy" : ""}`}>
              <label htmlFor="prompt" className="sr-only">
                Describe the app you want to create
              </label>
              <textarea
                ref={promptRef}
                id="prompt"
                aria-describedby={!hasStarted ? "app-capabilities" : undefined}
                value={prompt}
                maxLength={4000}
                disabled={generationDisabled}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  preview
                    ? "What would you like to change in this app?"
                    : "What would you like to build?"
                }
                rows={3}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submitPrompt();
                  }
                }}
              />
              <div className="composer-footer">
                <button
                  type="submit"
                  className="send-button"
                  disabled={generationDisabled || !prompt.trim()}
                  aria-label={hasStarted ? "Send prompt" : "Start building"}
                >
                  {isRunning ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : !hasStarted ? (
                    <>
                      Start building <ArrowRight size={16} />
                    </>
                  ) : (
                    <ArrowUp size={17} />
                  )}
                </button>
              </div>
            </div>
            {!hasStarted && (
              <p id="app-capabilities" className="app-capabilities">
                Create a single-page app that runs offline in your browser.
                Project code is saved; preview data resets on reload.
              </p>
            )}
            <div className="composer-hint">
              <span>
                {isHistorical ? (
                  `Viewing v${preview?.versionNumber}. Restore it to edit, or return to latest.`
                ) : (
                  <>
                    Enter to send <span aria-hidden="true">·</span> Shift +
                    Enter for a new line
                  </>
                )}
              </span>
              <span>{prompt.length}/4000</span>
            </div>
            {(!hasStarted || preview) && (
              <div className="prompt-suggestions">
                <span>{preview ? "Keep building" : "Try an idea"}</span>
                {preview ? (
                  <button
                    type="button"
                    disabled={generationDisabled}
                    onClick={() => {
                      setPrompt(
                        "Change this app to dark mode. Preserve all existing functionality.",
                      );
                      promptRef.current?.focus();
                    }}
                  >
                    Try dark mode <ChevronRight size={11} />
                  </button>
                ) : (
                  examples.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      data-selected={prompt === example.prompt}
                      disabled={generationDisabled}
                      onClick={() => {
                        setPrompt(example.prompt);
                        promptRef.current?.focus();
                      }}
                    >
                      {!hasStarted ? (
                        <>
                          <ExampleArtwork kind={example.label} />
                          <span className="example-copy">
                            <strong>{example.label}</strong>
                            <span>
                              {prompt === example.prompt ? (
                                <>
                                  Added to prompt{" "}
                                  <Check size={13} aria-hidden="true" />
                                </>
                              ) : (
                                <>
                                  Use idea{" "}
                                  <ArrowRight size={13} aria-hidden="true" />
                                </>
                              )}
                            </span>
                          </span>
                        </>
                      ) : (
                        example.label
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </form>
        </section>
        {hasStarted && (
          <section
            className={`preview-panel ${workspaceTab === "preview" ? "mobile-visible" : ""}`}
            aria-label="App Preview"
          >
            <div className="panel-header preview-header">
              <div className="panel-title">
                <Monitor size={15} />
                <h2>Preview</h2>
                {preview && (
                  <span className="preview-live">
                    <span className="status-dot" />
                    {previewReady ? "Live" : previewError ? "Error" : "Loading"}
                  </span>
                )}
              </div>
              <div className="preview-actions">
                <div className="device-switch" aria-label="Preview device">
                  <button
                    type="button"
                    className={device === "desktop" ? "selected" : ""}
                    aria-pressed={device === "desktop"}
                    aria-label="Desktop preview"
                    onClick={() => setDevice("desktop")}
                  >
                    <Monitor size={14} />
                    <span>Desktop</span>
                  </button>
                  <button
                    type="button"
                    className={device === "mobile" ? "selected" : ""}
                    aria-pressed={device === "mobile"}
                    aria-label="Mobile preview"
                    onClick={() => setDevice("mobile")}
                  >
                    <Smartphone size={14} />
                    <span>Mobile</span>
                  </button>
                </div>
                <span className="toolbar-divider" />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Reload preview"
                  title="Reload preview (resets application state)"
                  disabled={!preview}
                  onClick={reloadPreview}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
            {versions.length > 0 && (
              <details className="version-history">
                <summary>
                  <History size={15} />
                  <span>Version History</span>
                  <span className="version-count">{versions.length}</span>
                  <span className="version-current">
                    v{preview?.versionNumber}
                    {isHistorical ? " · Previewing" : " · Latest"}
                  </span>
                  <ChevronDown size={14} className="history-chevron" />
                </summary>
                <ol aria-label="Version history" className="version-list">
                  {[...versions].reverse().map((version) => (
                    <li
                      key={version.id}
                      className="version-item"
                      data-selected={version.id === preview?.versionId}
                    >
                      <button
                        type="button"
                        className="version-select"
                        aria-label={`Preview v${version.number}`}
                        aria-pressed={version.id === preview?.versionId}
                        disabled={inputDisabled}
                        onClick={() => previewVersion(version)}
                      >
                        <span className="version-meta">
                          <strong>v{version.number}</strong>
                          {version.id === latestVersion?.id && (
                            <span className="version-badge">Latest</span>
                          )}
                          {version.id === preview?.versionId &&
                            version.id !== latestVersion?.id && (
                              <span className="version-badge">Previewing</span>
                            )}
                          <time dateTime={version.createdAt}>
                            {versionTime(version.createdAt)}
                          </time>
                        </span>
                        <span className="version-prompt">{version.prompt}</span>
                      </button>
                      <button
                        type="button"
                        className="restore-button"
                        aria-label={`Restore v${version.number}`}
                        disabled={
                          inputDisabled || version.id === latestVersion?.id
                        }
                        onClick={() => void restoreVersion(version)}
                      >
                        {restoringVersionId === version.id ? (
                          <>
                            <LoaderCircle size={13} className="animate-spin" />{" "}
                            Restoring…
                          </>
                        ) : (
                          <>
                            <RotateCcw size={13} /> Restore
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {isHistorical && (
              <div className="historical-preview" role="status">
                <span>
                  Previewing v{preview?.versionNumber}. Latest is v
                  {latestVersion?.number}.
                </span>
                <button
                  type="button"
                  disabled={inputDisabled}
                  onClick={() => latestVersion && previewVersion(latestVersion)}
                >
                  Return to latest
                </button>
              </div>
            )}
            {isRestoring && (
              <p className="restore-status" role="status">
                Saving restored code as a new version. All existing versions are
                kept.
              </p>
            )}
            {restoreError && (
              <div className="restore-error" role="alert">
                <AlertCircle size={16} />
                <span>{restoreError}</span>
                <button
                  type="button"
                  disabled={inputDisabled}
                  onClick={() => {
                    const source = versions.find(
                      (item) =>
                        item.id === restoreAttemptRef.current?.versionId,
                    );
                    if (source) void restoreVersion(source, true);
                  }}
                >
                  Retry restore
                </button>
              </div>
            )}
            {previewError && (
              <div className="preview-error" role="alert">
                <AlertCircle size={14} aria-hidden="true" />
                <div className="preview-error-copy">
                  <strong>Preview could not run</strong>
                  <p>
                    Reload once. If it still fails, describe the problem in
                    Agent Chat
                    {versions.length > 1
                      ? ", or preview an earlier version in Version History."
                      : "."}
                  </p>
                  <details className="preview-error-details">
                    <summary>
                      Technical details{" "}
                      <ChevronDown size={13} aria-hidden="true" />
                    </summary>
                    <p>{previewError}</p>
                  </details>
                </div>
                <button type="button" onClick={reloadPreview}>
                  Reload
                </button>
              </div>
            )}
            <div className="preview-canvas">
              <GenerationField
                variant="preview"
                activity={
                  isRunning
                    ? "working"
                    : generationError
                      ? "error"
                      : preview
                        ? "complete"
                        : "idle"
                }
                phase={Math.max(activeStep, 0)}
                engagement={isRunning ? 0.85 : 0}
              />
              {preview ? (
                <div
                  className={`preview-frame ${device === "mobile" ? "preview-mobile" : "preview-desktop"}`}
                >
                  <div className="browser-bar">
                    <span className="browser-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="browser-address">
                      <span className="address-dot" />
                      {preview.app.title}
                    </span>
                  </div>
                  <iframe
                    ref={iframeRef}
                    key={`${preview.token}-${reloadKey}`}
                    title={`${preview.app.title} interactive preview`}
                    srcDoc={preview.srcDoc}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="preview-empty">
                  <span>
                    <WandSparkles size={27} />
                  </span>
                  <h3>
                    {isRunning
                      ? "Building your application"
                      : "Your app starts here"}
                  </h3>
                  <p>
                    {isRunning
                      ? "The model is generating a self-contained browser app. Your preview will appear once validation passes."
                      : "Describe an idea in Agent Chat. The generated application will run right here."}
                  </p>
                  {isRunning && (
                    <LoaderCircle size={20} className="animate-spin" />
                  )}
                </div>
              )}
            </div>
            <div className="preview-statusbar">
              <span>
                <span className="status-dot" />
                {isRunning
                  ? preview
                    ? "Updating application"
                    : "Generating application"
                  : previewError
                    ? "Runtime error"
                    : previewReady
                      ? `Preview running · v${preview?.versionNumber}`
                      : preview
                        ? "Loading preview"
                        : "Waiting for an idea"}
              </span>
              {preview && (
                <span className="preview-data-note">
                  Project code is saved; preview data resets on reload.
                </span>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
