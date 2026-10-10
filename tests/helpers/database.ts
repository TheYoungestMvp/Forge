import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { issueSession } from "../../src/lib/projects/session";

export const projectId = "11111111-1111-4111-8111-111111111111";
export const requestId = "33333333-3333-4333-8333-333333333333";
export const app = {
  title: "Counter",
  html: '<button type="button">Increment</button><output>0</output>',
  css: "body{color:#222}",
  javascript:
    "let count=0;document.querySelector('button').addEventListener('click',()=>document.querySelector('output').textContent=String(++count));",
};
export const plan = {
  steps: [
    "Create an Increment button and a visible count",
    "Update the count each time the Increment button is clicked",
  ],
};
let database: PGlite;
async function init() {
  if (database) return database;
  database = new PGlite();
  await database.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  for (const file of [
    "001_persistence.sql",
    "002_demo_hardening.sql",
    "003_project_deletion.sql",
  ])
    await database.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  return database;
}

type ModelInput = { messages: { role: string; content: string }[] };
type Options = {
  model?: (payload: ModelInput, signal: AbortSignal) => Promise<Response>;
  beforeFetch?: (url: URL, init?: RequestInit) => Promise<Response | void>;
};

export async function withDatabase(
  run: (context: {
    db: PGlite;
    ownerId: string;
    cookie: string;
    modelCalls: ModelInput[];
    request: (url: string, body?: unknown, cookie?: string) => Request;
    rpc: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  }) => Promise<void>,
  options: Options = {},
) {
  const db = await init();
  await db.exec(
    "truncate public.projects, public.messages, public.versions, public.deleted_project_attempts restart identity cascade;",
  );
  const keys = [
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FORGE_DEPLOYMENT",
    "FORGE_SESSION_SECRET",
    "DEMO_ACCESS_PASSWORD",
    "LLM_PROVIDER",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_OUTPUT_MODE",
    "LLM_MAX_TOKENS_FIELD",
    "LLM_THINKING_MODE",
    "GENERATION_TIMEOUT_MS",
  ];
  const original = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  const modelCalls: ModelInput[] = [];
  try {
    Object.assign(process.env, {
      SUPABASE_URL: "http://database.test",
      SUPABASE_SECRET_KEY: "test-server-secret",
      FORGE_DEPLOYMENT: "local",
      FORGE_SESSION_SECRET: "test-session-secret-32-characters-long",
      DEMO_ACCESS_PASSWORD: "",
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "http://model.test/v1",
      LLM_MODEL: "test-model",
      LLM_API_KEY: "test-model-key",
      LLM_OUTPUT_MODE: "json_object",
      LLM_MAX_TOKENS_FIELD: "max_tokens",
      LLM_THINKING_MODE: "disabled",
      GENERATION_TIMEOUT_MS: "120000",
    });
    const session = issueSession(
      new Request("http://localhost:3000/api/session"),
    );
    const cookie = session.cookie!.split(";")[0];
    function request(url: string, body?: unknown, authCookie = cookie) {
      return new Request(url, {
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
        headers: { Cookie: authCookie, "Content-Type": "application/json" },
      });
    }
    async function rpc(name: string, params: Record<string, unknown>) {
      if (!/^forge_[a-z_]+$/.test(name)) throw new Error("Invalid test RPC");
      const entries = Object.entries(params);
      const argumentsSql = entries.map(([key], index) => {
        if (!/^p_[a-z_]+$/.test(key)) throw new Error("Invalid test parameter");
        const type = ["p_app", "p_plan"].includes(key)
          ? "jsonb"
          : key.endsWith("_id") || key === "p_run_token"
            ? "uuid"
            : key === "p_deadline_at"
              ? "timestamptz"
              : key === "p_phase"
                ? "integer"
                : key === "p_status_only"
                  ? "boolean"
                  : "text";
        return `${key}=>$${index + 1}::${type}`;
      });
      const values = entries.map(([key, value]) =>
        ["p_app", "p_plan"].includes(key) ? JSON.stringify(value) : value,
      );
      const query = await db.query<{ value: Record<string, unknown> }>(
        `select public.${name}(${argumentsSql.join(",")}) as value`,
        values,
      );
      return query.rows[0].value;
    }
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const intercepted = await options.beforeFetch?.(url, init);
      if (intercepted) return intercepted;
      if (init?.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      const payload = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.hostname === "model.test") {
        modelCalls.push(payload);
        if (options.model) return options.model(payload, init!.signal!);
        const isPlan = payload.messages[0].content.startsWith(
          "Write a concise implementation plan",
        );
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(isPlan ? plan : app) },
            },
          ],
        });
      }
      try {
        if (url.pathname.includes("/rpc/"))
          return Response.json(
            await rpc(url.pathname.split("/").at(-1)!, payload),
          );
        if (
          !url.pathname.endsWith("/projects") &&
          !url.pathname.endsWith("/versions") &&
          !url.pathname.endsWith("/messages")
        )
          throw new Error("Unexpected test route");
        const table = url.pathname.split("/").at(-1)!;
        if (init?.method === "POST") {
          const fields = Object.keys(payload);
          if (!fields.every((field) => /^[a-z_]+$/.test(field)))
            throw new Error("Invalid test field");
          const inserted = await db.query(
            `insert into public.${table}(${fields.join(",")}) values(${fields.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
            Object.values(payload),
          );
          return Response.json(inserted.rows[0]);
        }
        const filters = [...url.searchParams].filter(
          ([key]) => !["select", "order", "limit"].includes(key),
        );
        const values: string[] = [];
        const clauses = filters.map(([field, value]) => {
          if (!/^[a-z_]+$/.test(field) || !value.startsWith("eq."))
            throw new Error("Unexpected test filter");
          values.push(value.slice(3));
          return `${field}=$${values.length}`;
        });
        const order = url.searchParams
          .get("order")
          ?.split(",")
          .map((field) => {
            if (!/^[a-z_]+\.(asc|desc)$/.test(field))
              throw new Error("Invalid test order");
            return field.replace(".", " ");
          });
        const result = await db.query(
          `select * from public.${table}${clauses.length ? " where " + clauses.join(" and ") : ""}${order?.length ? " order by " + order.join(",") : ""}${url.searchParams.has("limit") ? " limit 1" : ""}`,
          values,
        );
        const single = new Headers(init?.headers)
          .get("Accept")
          ?.includes("object+json");
        return Response.json(single ? (result.rows[0] ?? null) : result.rows);
      } catch (error) {
        const failure = error as { code?: string; message: string };
        return Response.json(
          { code: failure.code || "NETWORK", message: failure.message },
          { status: 400 },
        );
      }
    };
    await db.query(
      "insert into public.projects(id,name,owner_id) values($1,'Saved counter',$2)",
      [projectId, session.id],
    );
    await run({ db, ownerId: session.id, cookie, modelCalls, request, rpc });
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
}
