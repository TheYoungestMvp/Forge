import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Load proxy settings before spawning Node so its native fetch uses them.
// Loading through the API avoids passing --env-file into Next dev's NODE_OPTIONS.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const child = spawn(
  process.execPath,
  [
    "--use-env-proxy",
    fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  console.error("Unable to start Next.js:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
