import { execFile, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { GeneratedApp } from "../src/lib/generation/schema";
import type { BrowserEvaluation, BrowserOptions, EvalTask } from "./types";

function isolatedEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  const allowed = new Set(["path", "systemroot", "windir", "temp", "tmp", "tmpdir", "localappdata", "userprofile", "home", "lang", "lc_all"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toLowerCase()) && value !== undefined) result[key] = value;
  }
  // Provider keys, project environment, proxy settings, and database secrets are
  // deliberately absent in the process that executes generated JavaScript.
  return result;
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true, stdio: "ignore", env: isolatedEnvironment(),
      });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 5_000);
      killer.once("error", () => { clearTimeout(timer); child.kill(); resolve(); });
      killer.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  } else {
    const workerPid = child.pid;
    // Playwright starts Chromium in a separate POSIX process group. Pause the
    // worker group first so no new detached browser can escape our snapshot.
    try { process.kill(-workerPid, "SIGSTOP"); } catch { /* It may have exited. */ }
    try {
      const snapshot = await new Promise<string>((resolveSnapshot, reject) => {
        execFile("ps", ["-eo", "pid=,ppid=,pgid="], {
          env: isolatedEnvironment(), timeout: 1_500, maxBuffer: 4_194_304,
        }, (error, stdout) => error ? reject(error) : resolveSnapshot(stdout));
      });
      const rows = snapshot.trim().split(/\r?\n/).map((line) => {
        const [pid, parentPid, groupPid] = line.trim().split(/\s+/).map(Number);
        return { pid, parentPid, groupPid };
      }).filter((row) => [row.pid, row.parentPid, row.groupPid].every(Number.isSafeInteger));
      const descendants = new Set([workerPid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (descendants.has(row.parentPid) && !descendants.has(row.pid)) {
            descendants.add(row.pid);
            changed = true;
          }
        }
      }
      // Only target a group when its leader belongs to this worker's tree.
      // This excludes shared shell groups and unrelated user browser sessions.
      const groups = rows.filter((row) => descendants.has(row.pid) && row.pid === row.groupPid && row.pid !== workerPid);
      for (const { groupPid } of groups) {
        try { process.kill(-groupPid, "SIGKILL"); } catch { /* Already exited. */ }
      }
    } catch {
      // If ps is unavailable, Playwright's second SIGINT forces its registered
      // browser groups to exit. Resume Node so its cleanup handlers can run.
      for (const signal of ["SIGCONT", "SIGINT"] as const) {
        try { process.kill(-workerPid, signal); } catch { /* Already exited. */ }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      try { process.kill(-workerPid, "SIGINT"); } catch { /* Already exited. */ }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    } finally {
      try { process.kill(-workerPid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }
}

/** Each task gets a disposable credential-free process and its own browser. */
export async function evaluateBrowser(app: GeneratedApp, task: EvalTask, options: BrowserOptions = {}): Promise<BrowserEvaluation> {
  const start = performance.now();
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Browser timeout must be a positive number");
  const failure = (code: string, error: string): BrowserEvaluation => ({
    checks: task.checks.map(({ id, name, kind }) => ({ id, name, kind, passed: false, status: "not_run", error })),
    durationMs: Math.round(performance.now() - start), runtimeErrors: [], failureCode: code,
  });
  const cli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const worker = fileURLToPath(new URL("./browser-worker.ts", import.meta.url));
  return await new Promise<BrowserEvaluation>((resolve) => {
    const child = spawn(process.execPath, [cli, "--conditions=react-server", worker], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env: isolatedEnvironment(),
      windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", settled = false;
    const finish = (result: BrowserEvaluation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Math.round(performance.now() - start) });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void killTree(child).finally(() => resolve(failure("BROWSER_TIMEOUT", `浏览器评测超过 ${timeoutMs} ms，已终止整个进程树`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1_048_576 && !settled) {
        settled = true;
        clearTimeout(timer);
        void killTree(child).finally(() => resolve(failure("BROWSER_WORKER_ERROR", "浏览器工作进程输出超过限制")));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 8_192) stderr += chunk.toString("utf8"); });
    child.stdin.on("error", () => { /* An early worker failure is handled by close. */ });
    child.once("error", (error) => finish(failure("BROWSER_WORKER_ERROR", error.message)));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) { finish(failure("BROWSER_WORKER_ERROR", stderr.trim().slice(0, 1000) || `工作进程退出码 ${code}`)); return; }
      try {
        const result = JSON.parse(stdout.trim()) as BrowserEvaluation;
        if (!Array.isArray(result.checks) || !Array.isArray(result.runtimeErrors) || result.checks.length !== task.checks.length) throw new Error("Invalid browser result");
        for (let index = 0; index < task.checks.length; index++) {
          if (result.checks[index].id !== task.checks[index].id || typeof result.checks[index].passed !== "boolean") throw new Error("Mismatched browser assertions");
        }
        finish(result);
      } catch {
        finish(failure("BROWSER_WORKER_ERROR", stderr.trim().slice(0, 1000) || "浏览器工作进程未返回有效结果"));
      }
    });
    child.stdin.end(JSON.stringify({ app, taskId: task.id, options }));
  });
}
