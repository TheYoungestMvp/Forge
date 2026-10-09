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
  Layers2,
  LoaderCircle,
  MessageSquare,
  Monitor,
  PanelLeft,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  SquareArrowOutUpRight,
  WandSparkles,
  XCircle,
} from "lucide-react";
import {
  generationEventSchema,
  type AppVersion,
  type GeneratedApp,
} from "@/lib/generation/schema";
import { composePreview } from "@/lib/preview/compose";
import {
  projectSchema,
  projectSnapshotSchema,
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
};
type Preview = {
  app: GeneratedApp;
  srcDoc: string;
  token: string;
  model: string;
  versionNumber: number;
};

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
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectLoading, setProjectLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
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
  const lastAttemptRef = useRef<{
    id: string;
    projectId: string;
    prompt: string;
    baseVersionId: string | null;
  } | null>(null);
  const inputDisabled = isRunning || projectLoading;
  const hasStarted = messages.length > 0 || Boolean(preview);
  const workHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasStartedRef = useRef(false);

  const showVersion = useCallback((version: AppVersion) => {
    const token = crypto.randomUUID();
    previewTokenRef.current = token;
    previewSettledRef.current = false;
    setPreviewReady(false);
    setPreviewError(null);
    setPreview({
      app: version.app,
      srcDoc: composePreview(version.app, token),
      token,
      model: version.model,
      versionNumber: version.number,
    });
  }, []);

  const clearWorkspace = useCallback(() => {
    followChatRef.current = true;
    previewTokenRef.current = null;
    previewSettledRef.current = false;
    lastAttemptRef.current = null;
    setPreview(null);
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
    async (id: string | null) => {
      projectRequestRef.current?.abort();
      const controller = new AbortController();
      projectRequestRef.current = controller;
      loadTargetRef.current = id;
      setProjectLoading(true);
      setStorageError(null);
      try {
        const list = z
          .array(projectSchema)
          .parse(
            await projectJson(
              await fetch("/api/projects", {
                cache: "no-store",
                signal: controller.signal,
              }),
            ),
          );
        if (controller.signal.aborted) return;
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
          if (controller.signal.aborted) return;
          clearWorkspace();
          setProject(snapshot.project);
          setMessages(
            snapshot.messages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              saved: true,
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
          projectUrl(id, true);
        } else {
          clearWorkspace();
          setProject(null);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setStorageError(
            error instanceof Error
              ? error.message
              : "Could not load your project. Please retry.",
          );
      } finally {
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
    if (chat && followChatRef.current && (messages.length || isRunning)) {
      chat.scrollTo({ top: chat.scrollHeight, behavior: "auto" });
    }
  }, [messages, isRunning, generationError, activeStep, workspaceTab]);

  function mergeMessage(message: ProjectMessage) {
    const next: Message = {
      id: message.id,
      role: message.role,
      content: message.content,
      saved: true,
    };
    setMessages((previous) =>
      previous.some((item) => item.id === next.id)
        ? previous.map((item) => (item.id === next.id ? next : item))
        : [...previous, next],
    );
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
    if (isRunning || projectLoading || projectRequestRef.current) return;
    const controller = new AbortController();
    projectRequestRef.current = controller;
    setProjectLoading(true);
    setStorageError(null);
    try {
      const created = await createProjectRecord(controller.signal);
      if (controller.signal.aborted) return;
      clearWorkspace();
      setProject(created);
      setProjects((previous) => [created, ...previous]);
      setProjectName("");
      projectUrl(created.id);
      loadTargetRef.current = created.id;
      promptRef.current?.focus();
    } catch (error) {
      if (!controller.signal.aborted)
        setStorageError(
          error instanceof Error
            ? error.message
            : "Could not create the project. Please retry.",
        );
    } finally {
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
      inputDisabled ||
      requestRef.current ||
      content.length > 4000
    )
      return;
    const controller = new AbortController();
    followChatRef.current = true;
    requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 140000);
    setGenerationError(null);
    setStorageError(null);
    setActiveStep(0);
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
          if (event.message.role === "assistant") failureSaved = true;
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
      if (attempt && !failureSaved)
        setMessages((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            saved: false,
          },
        ]);
    } finally {
      clearTimeout(timer);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsRunning(false);
      }
    }
  }

  function startNewApp() {
    if (isRunning || projectLoading) return;
    clearWorkspace();
    setProject(null);
    setProjectName("");
    setStorageError(null);
    loadTargetRef.current = null;
    projectUrl(null);
  }

  function reloadPreview() {
    previewSettledRef.current = false;
    setPreviewReady(false);
    setPreviewError(null);
    setReloadKey((previous) => previous + 1);
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
          <span className="project-name" title={project?.name || "New project"}>
            {project?.name || "New project"}
          </span>
          <span className="project-label">Project</span>
        </div>
        <div className="header-right">
          <span className="workspace-note">
            <span className="status-dot" />
            {projectLoading
              ? "Loading projects…"
              : isRunning
                ? "Saving as you build"
                : storageError
                  ? "Storage unavailable"
                  : project
                    ? "Saved to Supabase"
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
              projectUrl(id);
              void loadWorkspace(id);
            }}
          >
            <option value="">Choose a saved project</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
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
          </button>
        </div>
      )}
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
                <span
                  className="agent-status"
                  data-state={
                    isRunning ? "working" : generationError ? "error" : "ready"
                  }
                >
                  {isRunning ? "Working" : generationError ? "Error" : "Ready"}
                </span>
              </div>
              <PanelLeft size={16} className="muted-icon" aria-hidden="true" />
            </div>
          )}
          {!hasStarted && (
            <div className="start-intro">
              <span className="start-mark" aria-hidden="true">
                <Layers2 size={28} strokeWidth={1.8} />
              </span>
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
                  </article>
                ))}
              </div>
              <div
                className="progress-card"
                aria-label="Agent progress"
                aria-busy={isRunning}
                data-state={
                  isRunning
                    ? "working"
                    : generationError
                      ? "failed"
                      : preview
                        ? "complete"
                        : "idle"
                }
              >
                <p className="sr-only" role="status">
                  {isRunning
                    ? steps[activeStep]
                    : generationError
                      ? "Generation failed"
                      : preview
                        ? "Completed — application generated"
                        : "Ready for a description"}
                </p>
                <div className="progress-heading">
                  <span>
                    <WandSparkles size={13} />
                    {isRunning
                      ? preview
                        ? "Updating your application"
                        : "Bringing your idea to life"
                      : generationError
                        ? "Generation failed"
                        : preview
                          ? "Application ready"
                          : "Ready when you are"}
                  </span>
                  <span className="progress-caption">
                    {preview
                      ? isRunning
                        ? `Creating v${versions.length + 1}`
                        : `v${preview.versionNumber}`
                      : "First generation"}
                  </span>
                </div>
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
                      disabled={isRunning}
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
                value={prompt}
                maxLength={4000}
                disabled={inputDisabled}
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
                <span className="composer-model">
                  <span className="status-dot" />
                  {preview?.model || "App Generator"}
                  <ChevronDown size={11} />
                </span>
                <button
                  type="submit"
                  className="send-button"
                  disabled={inputDisabled || !prompt.trim()}
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
            <div className="composer-hint">
              <span>
                Enter to send <span aria-hidden="true">·</span> Shift + Enter
                for a new line
              </span>
              <span>{prompt.length}/4000</span>
            </div>
            {(!hasStarted || preview) && (
              <div className="prompt-suggestions">
                <span>{preview ? "Keep building" : "Try an idea"}</span>
                {preview ? (
                  <button
                    type="button"
                    disabled={isRunning}
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
                      disabled={isRunning}
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
                              Use idea <ArrowRight size={13} />
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
              <div className="version-strip" aria-label="Generated versions">
                <span>Versions</span>
                <ol>
                  {versions.map((version) => (
                    <li
                      key={version.id}
                      aria-current={
                        version.number === preview?.versionNumber
                          ? "true"
                          : undefined
                      }
                      title={version.prompt}
                    >
                      v{version.number}
                      {version.number === preview?.versionNumber && " · Latest"}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {previewError && (
              <div className="preview-error" role="alert">
                <AlertCircle size={14} />
                <span>Preview runtime error: {previewError}</span>
                <button type="button" onClick={reloadPreview}>
                  Reload
                </button>
              </div>
            )}
            <div className="preview-canvas">
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
                      generated.app / preview
                    </span>
                    <SquareArrowOutUpRight size={11} aria-hidden="true" />
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
              <p className="preview-footnote">
                <Sparkles size={12} />
                {preview
                  ? "AI-generated browser app · isolated preview"
                  : "HTML + CSS + JavaScript · no setup required"}
              </p>
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
              <span>
                {device === "desktop"
                  ? "Desktop · responsive"
                  : "Mobile · up to 375px"}
                <span className="statusbar-divider">/</span>HTML · CSS ·
                JavaScript
              </span>
            </div>
          </section>
        )}
      </main>
      <footer className="app-footer">
        <span>From a spark to something real.</span>
        <span>
          Phase 4 <span aria-hidden="true">·</span> Saved projects
          <span className="footer-diamond">✧</span>
        </span>
      </footer>
    </div>
  );
}
