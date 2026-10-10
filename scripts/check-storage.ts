import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createStorageFetch,
  storageDispatcher,
} from "../src/lib/projects/transport";

async function main() {
  try {
    process.loadEnvFile(resolve(".env.local"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const args = process.argv.slice(2);
  function numberOption(name: string, fallback: number, max: number) {
    const index = args.indexOf(name);
    const value = index === -1 ? fallback : Number(args[index + 1]);
    if (!Number.isInteger(value) || value < 0 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  }
  const samples = Math.max(1, numberOption("--samples", 10, 100));
  const interval = numberOption("--interval-ms", 1000, 60000);
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key)
    throw new Error(
      "Configure SUPABASE_URL and a server-only Supabase key first.",
    );
  const url = new URL(
    "rest/v1/projects?select=id,owner_id&limit=0",
    base.replace(/\/$/, "") + "/",
  );
  const transport = createStorageFetch();
  let failures = 0;
  const durations: number[] = [];
  try {
    for (let sample = 1; sample <= samples; sample++) {
      const start = Date.now();
      try {
        const response = await transport(url, { headers: { apikey: key } });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        durations.push(Date.now() - start);
        console.log(
          JSON.stringify({
            sample,
            status: response.status,
            elapsedMs: Date.now() - start,
          }),
        );
      } catch (error) {
        failures++;
        console.log(
          JSON.stringify({
            sample,
            elapsedMs: Date.now() - start,
            error: (error as Error).name,
          }),
        );
      }
      if (sample < samples) await delay(interval);
    }
  } finally {
    await storageDispatcher().close();
  }
  console.log(
    JSON.stringify({
      samples,
      successes: samples - failures,
      failures,
      maxElapsedMs: durations.length ? Math.max(...durations) : null,
    }),
  );
  process.exitCode = failures ? 1 : 0;
}

void main().catch((error: Error) => {
  console.error("Storage check failed:", error.name);
  process.exitCode = 1;
});
