import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { GeneratedApp } from "../src/lib/generation/schema";
import { composePreview } from "../src/lib/preview/compose";
import { FIXED_NOW, fixedTasks } from "./tasks";
import type { BrowserEvaluation, BrowserOptions, EvalTask } from "./types";

type Input = { app: GeneratedApp; taskId: string; options?: BrowserOptions };
type PreviewState = { ready: boolean; errors: string[] };
type StateWindow = Window & { __forgeEvalState: PreviewState };

async function readInput(): Promise<Input> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 2_097_152) throw new Error("Browser input exceeds limit");
  }
  return JSON.parse(input) as Input;
}

function executablePath(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.platform !== "win32") return undefined;
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].find((candidate) => existsSync(candidate));
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 }, timezoneId: "Asia/Shanghai",
    locale: "zh-CN", serviceWorkers: "block", acceptDownloads: false,
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  // Consistent browser-local date makes overdue checks repeatable in every run.
  // Plain JavaScript avoids transpiler-injected name helpers in a serialized
  // function; those helpers do not exist inside the independent browser realm.
  await context.addInitScript({ content: `(()=>{
    const NativeDate = Date;
    const fixed = NativeDate.parse(${JSON.stringify(FIXED_NOW)});
    function FrozenDate(...args) {
      if (!new.target) return new NativeDate(fixed).toString();
      if (args.length === 0) return new NativeDate(fixed);
      return Reflect.construct(NativeDate, args);
    }
    Object.setPrototypeOf(FrozenDate, NativeDate);
    FrozenDate.prototype = NativeDate.prototype;
    Object.defineProperty(FrozenDate, 'now', { value: () => fixed });
    Object.defineProperty(window, 'Date', { value: FrozenDate, writable: false });
  })();` });
  return context;
}

async function loadPreview(page: Page, app: GeneratedApp) {
  const token = randomUUID();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
  await page.evaluate(({ html, token }) => {
    const state = window as unknown as StateWindow;
    state.__forgeEvalState = { ready: false, errors: [] };
    const frame = document.createElement("iframe");
    frame.name = "forge-eval";
    frame.title = "生成应用预览";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.cssText = "width:100vw;height:100vh;border:0";
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token || event.data?.channel !== "forge-preview") return;
      if (event.data.type === "ready") state.__forgeEvalState.ready = true;
      if (event.data.type === "error") state.__forgeEvalState.errors.push(String(event.data.message).slice(0, 1000));
    });
    frame.srcdoc = html;
    document.body.append(frame);
  }, { html: composePreview(app, token), token });
  await page.waitForFunction(() => {
    const state = (window as unknown as StateWindow).__forgeEvalState;
    return state.ready || state.errors.length > 0;
  }, undefined, { timeout: 5_000 });
  const state = await page.evaluate(() => (window as unknown as StateWindow).__forgeEvalState);
  if (state.errors.length > 0) throw new Error(state.errors.join("; "));
  const frame = page.frame({ name: "forge-eval" });
  if (!frame) throw new Error("Generated preview iframe is missing");
  return frame;
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1800);
}

async function evaluate(input: Input, task: EvalTask): Promise<BrowserEvaluation> {
  const start = performance.now();
  const runtimeErrors = new Set<string>();
  const checks: BrowserEvaluation["checks"] = [];
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true, executablePath: executablePath(input.options?.executablePath),
      timeout: Math.min(input.options?.timeoutMs ?? 30_000, 30_000),
      args: ["--disable-background-networking", "--disable-extensions", "--disable-component-update", "--no-first-run"],
    });
    for (const check of task.checks) {
      // Recreate the entire browsing context so no check can pass using another
      // check's state, DOM changes, globals, storage, or captured responses.
      const context = await createContext(browser);
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      page.on("pageerror", (error) => runtimeErrors.add(errorText(error)));
      page.on("popup", (popup) => { void popup.close(); });
      try {
        const frame = await loadPreview(page, input.app);
        await check.run(frame);
        const errors = await page.evaluate(() => (window as unknown as StateWindow).__forgeEvalState.errors);
        for (const error of errors) runtimeErrors.add(error);
        if (errors.length) throw new Error(errors.join("; "));
        checks.push({ id: check.id, name: check.name, kind: check.kind, passed: true, status: "passed" });
      } catch (error) {
        checks.push({ id: check.id, name: check.name, kind: check.kind, passed: false, status: "failed", error: errorText(error) });
        try {
          const errors = await page.evaluate(() => (window as unknown as StateWindow).__forgeEvalState?.errors ?? []);
          for (const message of errors) runtimeErrors.add(message);
        } catch { /* A crashed preview remains a failed check. */ }
        if (input.options?.screenshotDir) {
          try {
            await mkdir(input.options.screenshotDir, { recursive: true });
            const filename = `${task.id}-${check.id}.png`.replace(/[^a-zA-Z0-9_.-]/g, "_");
            await page.screenshot({ path: path.join(input.options.screenshotDir, filename), timeout: 2_000 });
          } catch { /* Screenshot errors must not change the assertion result. */ }
        }
      } finally {
        await context.close();
      }
    }
    return {
      checks, runtimeErrors: [...runtimeErrors], durationMs: Math.round(performance.now() - start),
      browserVersion: browser.version(), fixedBrowserTime: FIXED_NOW,
    };
  } catch (error) {
    const message = errorText(error);
    const completed = new Set(checks.map((check) => check.id));
    checks.push(...task.checks.filter((check) => !completed.has(check.id)).map(({ id, name, kind }) => ({ id, name, kind, passed: false, status: "not_run" as const, error: message })));
    return {
      checks, runtimeErrors: [...runtimeErrors], durationMs: Math.round(performance.now() - start),
      failureCode: browser ? "BROWSER_WORKER_ERROR" : "BROWSER_UNAVAILABLE",
      browserVersion: browser?.version(), fixedBrowserTime: FIXED_NOW,
    };
  } finally {
    await browser?.close();
  }
}

async function main() {
  const input = await readInput();
  const task = fixedTasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error(`Unknown fixed task: ${input.taskId}`);
  const result = await evaluate(input, task);
  process.stdout.write(JSON.stringify(result));
}

void main().catch((error) => {
  process.stderr.write(errorText(error));
  process.exitCode = 1;
});
