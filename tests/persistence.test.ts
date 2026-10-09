import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET as listProjects,
  POST as createProject,
} from "../src/app/api/projects/route";
import { GET as getProject } from "../src/app/api/projects/[projectId]/route";
import { POST as generate } from "../src/app/api/generate/route";
import { databaseError } from "../src/lib/projects/server";
import { toAppVersion } from "../src/lib/projects/schema";

const projectId = "11111111-1111-4111-8111-111111111111";
const baseId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const app = {
  title: "Counter",
  html: '<button type="button">Add</button><output>0</output>',
  css: "body{color:#222}",
  javascript:
    "let count=0;document.querySelector('button').addEventListener('click',()=>{document.querySelector('output').textContent=String(++count)});",
};
const project = {
  id: projectId,
  name: "Saved counter",
  created_at: "2026-10-09T01:00:00Z",
  updated_at: "2026-10-09T02:00:00Z",
};
const base = {
  ...app,
  id: baseId,
  project_id: projectId,
  version_number: 1,
  parent_id: null,
  prompt: "Build a counter",
  model: "test-model",
  created_at: "2026-10-09T01:01:00Z",
};
const version = {
  ...base,
  id: requestId,
  version_number: 2,
  parent_id: baseId,
  prompt: "Dark mode",
  css: "body{background:#111;color:#eee}",
};
const user = {
  id: requestId,
  project_id: projectId,
  request_id: requestId,
  role: "user",
  content: "Dark mode",
  seq: 3,
  created_at: "2026-10-09T02:00:00Z",
};
const assistant = {
  ...user,
  id: "44444444-4444-4444-8444-444444444444",
  role: "assistant",
  content: "v2 is ready",
  seq: 4,
};

async function withConfiguration(
  run: () => Promise<void>,
  handler?: typeof fetch,
) {
  const keys = [
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "LLM_PROVIDER",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_OUTPUT_MODE",
    "LLM_MAX_TOKENS_FIELD",
    "LLM_THINKING_MODE",
  ];
  const original = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      SUPABASE_URL: "http://localhost:4012",
      SUPABASE_SECRET_KEY: "test-server-secret",
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "https://model.test/v1",
      LLM_MODEL: "test-model",
      LLM_API_KEY: "test-model-key",
      LLM_OUTPUT_MODE: "json_object",
      LLM_MAX_TOKENS_FIELD: "max_tokens",
      LLM_THINKING_MODE: "disabled",
    });
    if (handler) globalThis.fetch = handler;
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("missing storage config returns a readable 503 rather than crashing the API", async () => {
  await withConfiguration(async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await listProjects();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "DATABASE_CONFIGURATION_ERROR");
    assert.match(body.error.message, /Project storage is not configured/);
  });
});

test("project routes reject invalid names, IDs and cross-origin writes", async () => {
  const invalidName = await createProject(
    jsonRequest("http://localhost:3000/api/projects", { name: " " }),
  );
  assert.equal(invalidName.status, 400);
  const crossOrigin = await createProject(
    jsonRequest(
      "http://localhost:3000/api/projects",
      { name: "Counter" },
      { Origin: "https://other.test" },
    ),
  );
  assert.equal(crossOrigin.status, 403);
  const invalidId = await getProject(
    new Request("http://localhost:3000/api/projects/nope"),
    { params: Promise.resolve({ projectId: "nope" }) },
  );
  assert.equal(invalidId.status, 400);
  const missingIds = await generate(
    jsonRequest("http://localhost:3000/api/generate", {
      prompt: "Build a counter",
    }),
  );
  assert.equal(missingIds.status, 400);
});

test("loading a project returns ordered chat and versions with persisted metadata", async () => {
  await withConfiguration(
    async () => {
      const response = await getProject(
        new Request(`http://localhost:3000/api/projects/${projectId}`),
        { params: Promise.resolve({ projectId }) },
      );
      assert.equal(response.status, 200);
      const snapshot = await response.json();
      assert.equal(snapshot.messages[0].role, "user");
      assert.equal(snapshot.messages[1].role, "assistant");
      const latest = toAppVersion(snapshot.versions.at(-1));
      assert.equal(latest.number, 2);
      assert.equal(latest.id, requestId);
      assert.equal(latest.parentId, baseId);
      assert.equal(latest.app.css, version.css);
    },
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/projects")) return Response.json([project]);
      if (url.pathname.endsWith("/messages")) {
        assert.equal(url.searchParams.get("order"), "seq.asc");
        return Response.json([user, assistant]);
      }
      assert.equal(url.searchParams.get("order"), "version_number.asc");
      return Response.json([base, version]);
    },
  );
});

test("database outages and missing migrations return actionable errors without raw details", async () => {
  await withConfiguration(
    async () => {
      const response = await listProjects();
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, "DATABASE_SCHEMA_MISSING");
      assert(!JSON.stringify(body).includes("sensitive SQL detail"));
      assert(!JSON.stringify(body).includes("test-server-secret"));
      assert.equal(databaseError({ code: "40001" }).status, 409);
      assert.equal(
        databaseError({ code: "NETWORK" }).code,
        "DATABASE_UNAVAILABLE",
      );
    },
    async () =>
      Response.json(
        { code: "PGRST205", message: "sensitive SQL detail" },
        { status: 404 },
      ),
  );
});

test("generation uses database context and emits complete only after atomic save", async () => {
  let committed = false;
  let modelCalls = 0;
  await withConfiguration(
    async () => {
      const body = {
        projectId,
        requestId,
        baseVersionId: baseId,
        prompt: "Dark mode",
        currentApp: { ...app, css: "body{color:red}" },
      };
      const response = await generate(
        jsonRequest("http://localhost:3000/api/generate", body),
      );
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        events
          .filter((event) => event.type === "status")
          .map((event) => event.step),
        [0, 1, 2, 3, 4],
      );
      assert.equal(events[0].type, "message");
      assert.equal(events.at(-1).type, "complete");
      assert.equal(events.at(-1).saved.version.id, requestId);
      assert.equal(committed, true);
      assert.equal(modelCalls, 1);
      const again = await generate(
        jsonRequest("http://localhost:3000/api/generate", body),
      );
      const retryEvents = (await again.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(retryEvents.at(-1).saved.version.id, requestId);
      assert.equal(
        modelCalls,
        1,
        "committed request retries do not call the model again",
      );
    },
    async (input, init) => {
      const url = new URL(String(input));
      const payload = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.hostname === "model.test") {
        modelCalls++;
        assert.deepEqual(JSON.parse(payload.messages[1].content), app);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ ...app, css: version.css }),
              },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/projects")) return Response.json([project]);
      if (url.pathname.endsWith("/messages")) {
        if (init?.method === "POST") return Response.json(user);
        if (url.searchParams.get("role") === "eq.assistant")
          return Response.json(assistant);
        return Response.json(committed ? [user] : []);
      }
      if (url.pathname.endsWith("/versions"))
        return Response.json(
          url.searchParams.has("id") ? (committed ? [version] : []) : [base],
        );
      assert(url.pathname.endsWith("/rpc/forge_save_generation"));
      assert.equal(payload.p_base_version_id, baseId);
      assert.deepEqual(payload.p_app, { ...app, css: version.css });
      committed = true;
      return Response.json({ project, version, message: assistant });
    },
  );
});

test("a failed save does not emit an unsaved generated version", async () => {
  await withConfiguration(
    async () => {
      const response = await generate(
        jsonRequest("http://localhost:3000/api/generate", {
          projectId,
          requestId,
          baseVersionId: baseId,
          prompt: "Dark mode",
        }),
      );
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        events.some((event) => event.type === "complete"),
        false,
      );
      assert.equal(events.at(-1).code, "DATABASE_UNAVAILABLE");
    },
    async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "model.test")
        return Response.json({
          choices: [{ message: { content: JSON.stringify(app) } }],
        });
      if (url.pathname.endsWith("/projects")) return Response.json([project]);
      if (url.pathname.endsWith("/messages"))
        return Response.json(init?.method === "POST" ? user : []);
      if (url.pathname.endsWith("/versions"))
        return Response.json(url.searchParams.has("id") ? [] : [base]);
      return Response.json(
        { code: "NETWORK", message: "database down" },
        { status: 503 },
      );
    },
  );
});
