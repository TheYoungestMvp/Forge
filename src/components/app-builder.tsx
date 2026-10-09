"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Compass,
  FlaskConical,
  Layers2,
  LoaderCircle,
  MessageSquare,
  Monitor,
  PanelLeft,
  RotateCcw,
  Smartphone,
  Sparkles,
  SquareArrowOutUpRight,
  WandSparkles,
} from "lucide-react";
import { mockPreview } from "@/lib/mock-preview";

const steps = [
  "Understanding requirements",
  "Planning application",
  "Generating code",
  "Validating application",
  "Completed",
];

type Message = { id: number; role: "user" | "assistant"; content: string };

const initialMessages: Message[] = [
  {
    id: 1,
    role: "user",
    content:
      "Build a calm, minimal task manager. I want to add tasks, check them off, and keep track of my day.",
  },
  {
    id: 2,
    role: "assistant",
    content:
      "Meet Daylight — a little more focus, a little less noise. Your interactive mock preview is ready to explore.",
  },
];

export function AppBuilder() {
  const [messages, setMessages] = useState(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(steps.length - 1);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "preview">("chat");
  const [reloadKey, setReloadKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const nextMessageId = useRef(3);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (messages.length > initialMessages.length || isRunning) {
      messageEndRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    }
  }, [messages, isRunning]);

  function submitPrompt() {
    const content = prompt.trim();
    if (!content || isRunning || timerRef.current || content.length > 4000)
      return;
    const userMessageId = nextMessageId.current++;
    setMessages((previous) => [
      ...previous,
      { id: userMessageId, role: "user", content },
    ]);
    setPrompt("");
    setIsRunning(true);
    setActiveStep(0);
    let step = 0;
    timerRef.current = setInterval(() => {
      step += 1;
      setActiveStep(step);
      if (step === steps.length - 1) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        const assistantMessageId = nextMessageId.current++;
        setMessages((previous) => [
          ...previous,
          {
            id: assistantMessageId,
            role: "assistant",
            content:
              "Mock run completed. This phase demonstrates the Agent workflow with a fixed example. Your prompt wasn't sent to a model, and the preview remains unchanged.",
          },
        ]);
        setIsRunning(false);
      }
    }, 850);
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
          <span>Daylight Workspace</span>
          <span className="project-label">Project</span>
        </div>
        <div className="header-right">
          <span className="mock-badge">
            <FlaskConical size={12} /> Mock mode
          </span>
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
          <span className="status-dot" /> All changes stay in this demo
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
                {isRunning ? "Working" : "Ready"}
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
                <br className="desktop-break" /> one conversation at a time.
              </p>
              <div className="welcome-tags">
                <span>
                  <Code2 size={11} /> Browser apps
                </span>
                <span>
                  <Sparkles size={11} /> Natural language
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
                      <span className="message-label">MOCK</span>
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
                  : "Completed — mock preview ready"}
              </p>
              <div className="progress-heading">
                <span>
                  <WandSparkles size={13} />
                  {isRunning
                    ? "Bringing your idea to life"
                    : "Application ready"}
                </span>
                <span className="progress-caption">Mock run</span>
              </div>
              <ol>
                {steps.map((label, index) => {
                  const done =
                    index < activeStep || (!isRunning && index === activeStep);
                  const current = isRunning && index === activeStep;
                  return (
                    <li
                      key={label}
                      className={
                        done
                          ? "step-done"
                          : current
                            ? "step-active"
                            : "step-pending"
                      }
                      aria-current={current ? "step" : undefined}
                    >
                      <span className="step-icon">
                        {done ? (
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
            <div ref={messageEndRef} />
          </div>

          <form
            className="composer-area"
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
          >
            <div className="prompt-suggestions">
              <span>Try a follow-up</span>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => {
                  setPrompt(
                    "Add a dark theme while keeping all existing features.",
                  );
                  promptRef.current?.focus();
                }}
              >
                Add a dark theme <ChevronRight size={11} />
              </button>
            </div>
            <div className={`composer ${isRunning ? "composer-busy" : ""}`}>
              <label htmlFor="prompt" className="sr-only">
                Describe your app or request a change
              </label>
              <textarea
                ref={promptRef}
                id="prompt"
                value={prompt}
                maxLength={4000}
                disabled={isRunning}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What would you like to build or change?"
                rows={3}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submitPrompt();
                  }
                }}
              />
              <div className="composer-footer">
                <span className="composer-model">
                  <span className="status-dot" /> Mock Agent{" "}
                  <ChevronDown size={11} />
                </span>
                <button
                  type="submit"
                  className="send-button"
                  disabled={isRunning || !prompt.trim()}
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
              <span className="preview-live">
                <span className="status-dot" /> Live
              </span>
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
                title="Reload preview (resets example tasks)"
                onClick={() => setReloadKey((previous) => previous + 1)}
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          <div className="preview-canvas">
            <div className="canvas-caption">
              <span className="canvas-caption-line" />
              YOUR IDEA, IN ACTION
              <span className="canvas-caption-line" />
            </div>
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
                  daylight.app / preview
                </span>
                <SquareArrowOutUpRight size={11} aria-hidden="true" />
              </div>
              <iframe
                key={reloadKey}
                title="Daylight interactive task manager mock preview"
                srcDoc={mockPreview}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            </div>
            <p className="preview-footnote">
              <Sparkles size={12} />A working example. Add a task, check it off,
              make it yours.
            </p>
          </div>
          <div className="preview-statusbar">
            <span>
              <span className="status-dot" /> Preview running
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
          Phase 1 <span aria-hidden="true">·</span> UI demo{" "}
          <span className="footer-diamond">✧</span>
        </span>
      </footer>
    </div>
  );
}
