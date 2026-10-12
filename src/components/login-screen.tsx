"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Eye,
  EyeOff,
  History,
  Layers2,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";

const sampleTasks = ["写下第一个想法", "把想法变成应用", "试试勾选这条任务"];

export function LoginScreen({ destination }: { destination: string }) {
  const [completed, setCompleted] = useState([true, false, false]);
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [capsLock, setCapsLock] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "用户名或密码不正确，请检查后重试。"
            : response.status === 503
              ? "登录暂时不可用，请稍后重试。"
              : "暂时无法登录，请稍后重试。",
        );
        inputRef.current?.focus();
        return;
      }
      // A full navigation discards cached visitor UI after the cookie changes.
      window.location.assign(new URL(destination, window.location.origin).href);
    } catch {
      setError("连接未完成，请检查网络后重试。");
      inputRef.current?.focus();
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="login-shell" lang="zh-CN">
      <section className="login-showcase" aria-labelledby="login-intro-title">
        <Link
          href="/"
          className="login-brand brand"
          aria-label="返回 Forge 首页"
        >
          <span className="brand-mark">
            <Layers2 size={19} aria-hidden="true" />
          </span>
          <span>
            Forge<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="login-intro">
          <h1 id="login-intro-title">
            从一个想法，
            <br />
            到可操作的应用。
          </h1>
          <p>
            用自然语言描述需求，与 AI 一起构建、预览，
            <br className="login-desktop-break" />
            再把下一次修改变成新的版本。
          </p>
        </div>
        <div className="login-demo" aria-label="应用构建交互示例">
          <div className="login-demo-bar">
            <span>
              <span className="login-demo-dot" />
              待办清单
            </span>
            <span>交互示例</span>
          </div>
          <div className="login-demo-body">
            <div className="login-demo-chat">
              <span className="login-demo-panel-label">
                <MessageSquare size={15} aria-hidden="true" />
                需求
              </span>
              <p className="login-demo-prompt">
                帮我做一个简洁的待办清单，可以勾选完成的任务。
              </p>
              <div className="login-demo-reply">
                <Sparkles size={16} aria-hidden="true" />
                <p>从清晰的任务列表开始，让每一步都有进展。</p>
              </div>
            </div>
            <div className="login-demo-preview">
              <div className="login-demo-title">
                <h2>
                  留一点空间，
                  <br />
                  给今天的想法。
                </h2>
                <span>{completed.filter(Boolean).length} / 3 已完成</span>
              </div>
              <div className="login-demo-tasks">
                {sampleTasks.map((task, index) => (
                  <label className="login-demo-task" key={task}>
                    <input
                      type="checkbox"
                      checked={completed[index]}
                      onChange={() =>
                        setCompleted((current) =>
                          current.map((value, i) =>
                            i === index ? !value : value,
                          ),
                        )
                      }
                    />
                    <span>{task}</span>
                  </label>
                ))}
              </div>
              <p className="login-demo-hint">
                勾选任务，体验应用交互
                <ArrowRight size={14} aria-hidden="true" />
              </p>
            </div>
          </div>
        </div>
        <ul className="login-capabilities" aria-label="Forge 功能">
          <li>
            <MessageSquare size={16} aria-hidden="true" />
            自然语言构建
          </li>
          <li>
            <Layers2 size={16} aria-hidden="true" />
            可交互预览
          </li>
          <li>
            <History size={16} aria-hidden="true" />
            版本保存与恢复
          </li>
        </ul>
      </section>
      <section className="login-access" aria-labelledby="login-form-title">
        <div className="login-access-label">
          <LockKeyhole size={16} aria-hidden="true" />
          账号登录
        </div>
        <div className="login-form-wrap">
          <h2 id="login-form-title">登录 Forge</h2>
          <p className="login-form-description">
            继续你的应用创作，把想法变成下一个作品。
          </p>
          <form className="login-form" onSubmit={login} aria-busy={pending}>
            <label htmlFor="login-username">用户名</label>
            <div
              className="login-password-field login-username-field"
              data-invalid={!!error}
            >
              <UserRound size={18} aria-hidden="true" />
              <input
                id="login-username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="请输入用户名"
                required
                maxLength={128}
                readOnly={pending}
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            <label htmlFor="access-password">密码</label>
            <div className="login-password-field" data-invalid={!!error}>
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                ref={inputRef}
                id="access-password"
                name="password"
                type={visible ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                onKeyUp={(event) =>
                  setCapsLock(event.getModifierState("CapsLock"))
                }
                onKeyDown={(event) =>
                  setCapsLock(event.getModifierState("CapsLock"))
                }
                onBlur={() => setCapsLock(false)}
                autoComplete="current-password"
                placeholder="请输入密码"
                required
                maxLength={1024}
                readOnly={pending}
                aria-invalid={!!error}
                aria-describedby={`login-password-help${error ? " login-error" : ""}${capsLock ? " login-caps-lock" : ""}`}
              />
              <button
                type="button"
                className="login-password-toggle"
                aria-label={visible ? "隐藏密码" : "显示密码"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            <p id="login-password-help" className="login-password-help">
              密码区分大小写。
            </p>
            {capsLock && (
              <p
                id="login-caps-lock"
                className="login-password-help"
                role="status"
              >
                大写锁定已开启。
              </p>
            )}
            <div
              className="login-feedback"
              aria-live="polite"
              aria-atomic="true"
            >
              {error && (
                <p id="login-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button
              className="login-submit"
              type="submit"
              disabled={pending || !username.trim() || !password}
            >
              <span>{pending ? "正在登录…" : "登录并进入工作台"}</span>
              {pending ? (
                <LoaderCircle
                  size={18}
                  className="login-spinner"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight size={18} aria-hidden="true" />
              )}
            </button>
          </form>
          <div className="login-session-note">
            <Plus size={16} aria-hidden="true" />
            <p>
              项目与版本保存在当前浏览器的会话中。
              <br />
              保留浏览器 Cookie，下次回来继续创作。
            </p>
          </div>
        </div>
        <p className="login-footer">一个想法，就是一个开始。</p>
      </section>
    </main>
  );
}
