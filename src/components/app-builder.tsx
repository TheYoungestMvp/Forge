"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
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

const steps = [
  "Understanding requirements",
  "Planning application",
  "Generating code",
  "Validating application",
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
type Message = { id: number; role: "user" | "assistant"; content: string };
type Preview = {
  app: GeneratedApp;
  srcDoc: string;
  token: string;
  model: string;
  versionNumber: number;
};

export function AppBuilder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "preview">("chat");
  const [reloadKey, setReloadKey] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const previewTokenRef = useRef<string | null>(null);
  const previewSettledRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const nextMessageId = useRef(1);
  const inputDisabled = isRunning;

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
    if (messages.length || isRunning) {
      messageEndRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    }
  }, [messages, isRunning, generationError]);

  function appendMessage(role: Message["role"], content: string) {
    const id = nextMessageId.current++;
    setMessages((previous) => [...previous, { id, role, content }]);
  }

  async function submitPrompt(value = prompt) {
    const content = value.trim();
    if (
      !content ||
      inputDisabled ||
      requestRef.current ||
      content.length > 4000
    )
      return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 140000);
    appendMessage("user", content);
    setLastPrompt(content);
    setPrompt("");
    setGenerationError(null);
    setActiveStep(0);
    setIsRunning(true);
    let completed = false;
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          ...(preview ? { currentApp: preview.app } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
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
        if (event.type === "status") setActiveStep(event.step);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "complete") {
          const parentVersion = versions.at(-1);
          const version: AppVersion = {
            id: crypto.randomUUID(),
            number: versions.length + 1,
            parentId: parentVersion?.id ?? null,
            createdAt: new Date().toISOString(),
            prompt: content,
            model: event.model,
            app: event.app,
          };
          setVersions((previous) => [...previous, version]);
          const token = crypto.randomUUID();
          previewTokenRef.current = token;
          previewSettledRef.current = false;
          setPreviewReady(false);
          setPreviewError(null);
          setPreview({
            app: event.app,
            srcDoc: composePreview(event.app, token),
            token,
            model: event.model,
            versionNumber: version.number,
          });
          setActiveStep(4);
          appendMessage(
            "assistant",
            `v${version.number} of ${event.app.title} is ready${parentVersion ? `, updated from v${parentVersion.number}` : ""}. Try its controls in Preview, or describe what you'd like to change next.`,
          );
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
      const message = controller.signal.aborted
        ? "The generation request was interrupted or timed out. Please retry."
        : error instanceof Error
          ? error.message
          : "Generation failed. Please try again.";
      setGenerationError(message);
      appendMessage("assistant", message);
    } finally {
      clearTimeout(timer);
      requestRef.current = null;
      setIsRunning(false);
    }
  }

  function startNewApp() {
    if (isRunning) return;
    previewTokenRef.current = null;
    previewSettledRef.current = false;
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
  }

  function reloadPreview() {
    previewSettledRef.current = false;
    setPreviewReady(false);
    setPreviewError(null);
    setReloadKey((previous) => previous + 1);
  }

  return (
    <div className="builder-shell">
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
          <span className="project-name">
            {preview?.app.title || "Untitled project"}
          </span>
          <span className="project-label">Project</span>
        </div>
        <div className="header-right">
          <span className="mock-badge">
            <Sparkles size={12} /> AI generation
          </span>
          {preview && (
            <button
              type="button"
              className="new-app-button"
              disabled={isRunning}
              onClick={startNewApp}
            >
              <Plus size={12} /> New app
            </button>
          )}
          <span className="avatar" aria-label="Demo user">
            Y
          </span>
        </div>
      </header>
      <div className="workspace-topline">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>
            Ideas become interfaces<span>.</span>
          </h1>
        </div>
        <span className="workspace-note">
          <span className="status-dot" />
          Session only · resets on refresh
        </span>
      </div>
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
      <main className="workspace">
        <section
          className={`chat-panel ${workspaceTab === "chat" ? "mobile-visible" : ""}`}
          aria-label="Agent Chat"
        >
          <div className="panel-header">
            <div className="panel-title">
              <span className="agent-symbol">
                <Sparkles size={15} />
              </span>
              <h2>Agent Chat</h2>
              <span className="agent-status">
                {isRunning ? "Working" : generationError ? "Error" : "Ready"}
              </span>
            </div>
            <PanelLeft size={16} className="muted-icon" aria-hidden="true" />
          </div>
          <div className="chat-scroll">
            <div className="welcome-card">
              <span className="welcome-icon">
                <WandSparkles size={20} />
              </span>
              <h3>Let&apos;s build something great.</h3>
              <p>
                Describe your idea. I&apos;ll help bring it to life,
                <br className="desktop-break" />
                then refine it step by step.
              </p>
              <div className="welcome-tags">
                <span>
                  <Code2 size={11} />
                  Browser apps
                </span>
                <span>
                  <Sparkles size={11} />
                  Natural language
                </span>
              </div>
            </div>
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
                  </div>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            <div
              className="progress-card"
              aria-label="Agent progress"
              aria-busy={isRunning}
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
              <ol>
                {steps.map((label, index) => {
                  const done =
                    index < activeStep ||
                    (activeStep === 4 &&
                      index === 4 &&
                      !isRunning &&
                      !generationError);
                  const current = isRunning && index === activeStep;
                  const failed =
                    Boolean(generationError) && index === activeStep;
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
                      {index === 4 && done && (
                        <span className="step-working">Ready to explore</span>
                      )}
                    </li>
                  );
                })}
              </ol>
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
                    onClick={() => void submitPrompt(lastPrompt)}
                  >
                    Retry generation
                  </button>
                </div>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>
          <form
            className="composer-area"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt();
            }}
          >
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
                    {example.label}
                  </button>
                ))
              )}
            </div>
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
                  aria-label="Send prompt"
                >
                  {isRunning ? (
                    <LoaderCircle size={15} className="animate-spin" />
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
          </form>
        </section>
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
            <div className="canvas-caption">
              <span className="canvas-caption-line" />
              YOUR IDEA, IN ACTION
              <span className="canvas-caption-line" />
            </div>
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
      </main>
      <footer className="app-footer">
        <span>From a spark to something real.</span>
        <span>
          Phase 3 <span aria-hidden="true">·</span> Build and refine
          <span className="footer-diamond">✧</span>
        </span>
      </footer>
    </div>
  );
}
