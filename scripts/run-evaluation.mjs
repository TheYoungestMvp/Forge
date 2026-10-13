import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const child = spawn(
  process.execPath,
  [
    "--use-env-proxy",
    "--conditions=react-server",
    "--import",
    "tsx",
    fileURLToPath(new URL("../evals/run.ts", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
child.on("error", () => {
  console.error("Unable to start evaluation.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
