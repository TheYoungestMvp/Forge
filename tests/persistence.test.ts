import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  GET as listProjects,
  POST as createProject,
} from "../src/app/api/projects/route";
import {
  GET as getProject,
  DELETE as deleteProject,
} from "../src/app/api/projects/[projectId]/route";
import { POST as generate } from "../src/app/api/generate/route";
import { POST as restore } from "../src/app/api/projects/[projectId]/restore/route";
import { POST as startSession } from "../src/app/api/session/route";
import {
  issueSession,
  readSession,
  assertDemoAccess,
} from "../src/lib/projects/session";
import { getSupabase, databaseError } from "../src/lib/projects/server";
import { recoverRequest } from "../src/lib/generation/recovery";
import { projectSnapshotSchema } from "../src/lib/projects/schema";
import {
  app,
  plan,
  projectId,
  requestId,
  withDatabase,
} from "./helpers/database";

const url = "http://localhost:3000/api/generate";
const input = {
  projectId,
  requestId,
  prompt: "Build a counter",
  baseVersionId: null,
};
const context = { params: Promise.resolve({ projectId }) };
const projectUrl = `http://localhost:3000/api/projects/${projectId}`;
function deletionRequest(request: Request) {
  return new Request(request, { method: "DELETE" });
}
async function events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("session cookie is signed, HttpOnly, stable across reloads and rejects tampering", async () => {
  await withDatabase(async ({ request, cookie, ownerId }) => {
    const session = await startSession(
      request("http://localhost:3000/api/session", {}),
    );
    assert.equal((await session.json()).id, ownerId);
    assert.equal(session.headers.get("set-cookie"), null);
    assert.equal(
      readSession(new Request(url, { headers: { Cookie: cookie + "x" } })),
      null,
    );
    const fresh = await startSession(
      new Request("http://localhost:3000/api/session", { method: "POST" }),
    );
    assert.match(fresh.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  });
});

test("public mode fails closed without configuration and requires demo password", async () => {
  await withDatabase(async ({ request }) => {
    process.env.FORGE_DEPLOYMENT = "public";
    assert.throws(
      () => assertDemoAccess(request(url)),
      /Public demo access is not configured/,
    );
    process.env.DEMO_ACCESS_PASSWORD = "a-valid-demo-password";
    assert.throws(() => assertDemoAccess(request(url)), /demo access password/);
    const headers = {
      Authorization: `Basic ${Buffer.from("demo:a-valid-demo-password").toString("base64")}`,
    };
    const signed = issueSession(new Request(url, { headers }));
    assert.match(signed.cookie!, /; Secure$/);
    assertDemoAccess(new Request(url, { headers }));
  });
});

test("storage config and runtime errors identify the real cause", async () => {
  await withDatabase(async ({ request }) => {
    const socket = globalThis.WebSocket;
    try {
      Object.assign(globalThis, { WebSocket: undefined });
      assert.throws(() => getSupabase(), /Node.js 24.*WebSocket/);
    } finally {
      globalThis.WebSocket = socket;
    }
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await listProjects(
      request("http://localhost:3000/api/projects"),
    );
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error.code,
      "DATABASE_CONFIGURATION_ERROR",
    );
    assert.equal(
      databaseError({ code: "PGRST202" }).code,
      "DATABASE_SCHEMA_MISSING",
    );
  });
});

test("two anonymous sessions cannot list, read, generate, or restore each other's project", async () => {
  await withDatabase(async ({ request, modelCalls }) => {
    const other = issueSession(new Request(url)).cookie!.split(";")[0];
    assert.equal(
      (
        await (
          await listProjects(request("http://localhost:3000/api/projects"))
        ).json()
      ).length,
      1,
    );
    assert.deepEqual(
      await (
        await listProjects(
          request("http://localhost:3000/api/projects", undefined, other),
        )
      ).json(),
      [],
    );
    for (const response of [
      await getProject(request(projectUrl, undefined, other), context),
      await generate(request(url, input, other)),
      await restore(
        request(
          `${projectUrl}/restore`,
          {
            versionId: randomUUID(),
            requestId: randomUUID(),
            baseVersionId: randomUUID(),
          },
          other,
        ),
        context,
      ),
    ])
      assert.equal(response.status, 404);
    assert.equal(modelCalls.length, 0);
    assert.equal(
      (await generate(new Request(url, { method: "POST" }))).status,
      401,
    );
  });
});

test("project input, origins, IDs, body limits and stale bases are validated before model calls", async () => {
  await withDatabase(async ({ request, ownerId, modelCalls }) => {
    assert.equal(
      (
        await createProject(
          request("http://localhost:3000/api/projects", { name: " " }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await createProject(
          request("http://localhost:3000/api/projects", {
            name: "Counter",
            owner_id: ownerId,
          }),
        )
      ).status,
      400,
    );
    const cross = request(url, input);
    cross.headers.set("Origin", "https://other.test");
    assert.equal((await generate(cross)).status, 403);
    assert.equal(
      (await generate(request(url, { prompt: "Counter" }))).status,
      400,
    );
    assert.equal(
      (await generate(request(url, { ...input, baseVersionId: randomUUID() })))
        .status,
      409,
    );
    assert.equal(
      (await generate(request(url, { ...input, prompt: "x".repeat(4001) })))
        .status,
      400,
    );
    assert.equal(
      (
        await generate(
          request(url, { ...input, extra: "x".repeat(1024 * 1024) }),
        )
      ).status,
      413,
    );
    assert.equal(modelCalls.length, 0);
  });
});

test("planning is concrete, persisted before generation and completed version/message save atomically", async () => {
  await withDatabase(async ({ request, db, modelCalls }) => {
    const output = await events(await generate(request(url, input)));
    assert.equal(output.at(-1).type, "complete");
    assert.deepEqual(output.find((event) => event.type === "plan").plan, plan);
    assert(
      output.some(
        (event) =>
          event.type === "message" &&
          event.message.status === "processing" &&
          event.message.plan.length === 2,
      ),
    );
    const snapshot = projectSnapshotSchema.parse(
      await (await getProject(request(projectUrl), context)).json(),
    );
    assert.equal(snapshot.versions.length, 1);
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.messages[1].status, "completed");
    assert.deepEqual(snapshot.messages[1].plan, plan.steps);
    assert.equal(recoverRequest(snapshot), null);
    assert.equal(modelCalls.length, 2, "one planning call and one code call");
    assert.match(
      modelCalls[1].messages[0].content,
      /Implement this agreed plan/,
    );
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      1,
    );
  });
});

test("invalid or generic planning cannot advance to code generation", async () => {
  for (const steps of [
    ["Understanding requirements", "Generating code"],
    ["Repeat this step", "Repeat this step"],
    ["Only one step"],
  ]) {
    await withDatabase(
      async ({ request, modelCalls, db }) => {
        const output = await events(await generate(request(url, input)));
        assert.equal(output.at(-1).code, "INVALID_PLAN");
        assert.equal(modelCalls.length, 1, "no code call after invalid plan");
        assert.equal(
          (await db.query("select * from public.versions")).rows.length,
          0,
        );
      },
      {
        model: async () =>
          Response.json({
            choices: [{ message: { content: JSON.stringify({ steps }) } }],
          }),
      },
    );
  }
});

test("concurrent same-ID retry returns 202 without a second plan/code call; late failure cannot replace success", async () => {
  let planning!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    planning = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withDatabase(
    async ({ request, db, rpc, ownerId, modelCalls }) => {
      const first = await generate(request(url, input));
      const firstBody = events(first);
      await reached;
      const duplicate = await generate(request(url, input));
      assert.equal(duplicate.status, 202);
      assert.equal((await duplicate.json()).state, "processing");
      const another = await generate(
        request(url, { ...input, requestId: randomUUID() }),
      );
      assert.equal(another.status, 409);
      const token = (
        await db.query<{ run_token: string }>(
          "select run_token from public.messages where role='assistant'",
        )
      ).rows[0].run_token;
      release();
      assert.equal((await firstBody).at(-1).type, "complete");
      const failed = await rpc("forge_fail_generation", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_request_id: requestId,
        p_run_token: token,
        p_code: "LATE_ERROR",
        p_message: "Never overwrite success",
      });
      assert.equal(failed.state, "completed");
      const again = await events(await generate(request(url, input)));
      assert.equal(again.at(-1).saved.message.status, "completed");
      assert.match(again.at(-1).saved.message.content, /is ready/);
      assert.equal(modelCalls.length, 2);
      assert.equal(
        (await db.query("select * from public.versions")).rows.length,
        1,
      );
    },
    {
      model: async (payload) => {
        const isPlan = payload.messages[0].content.startsWith(
          "Write a concise implementation plan",
        );
        if (isPlan) {
          planning();
          await gate;
        }
        return Response.json({
          choices: [
            { message: { content: JSON.stringify(isPlan ? plan : app) } },
          ],
        });
      },
    },
  );
});

test("modification uses exact stored code; forged client context cannot replace it", async () => {
  await withDatabase(async ({ request, modelCalls }) => {
    await events(await generate(request(url, input)));
    const follow = await events(
      await generate(
        request(url, {
          ...input,
          requestId: randomUUID(),
          baseVersionId: requestId,
          prompt: "Dark mode",
          currentApp: { ...app, css: "body{color:red}" },
        }),
      ),
    );
    assert.equal(follow.at(-1).saved.version.version_number, 2);
    assert.equal(modelCalls[2].messages.length, 2);
    const planningInput = JSON.parse(modelCalls[2].messages[1].content);
    assert.deepEqual(planningInput.currentApp, app);
    assert.equal(planningInput.requirements, "Dark mode");
    assert.match(planningInput.instruction, /Do not implement/);
    assert.deepEqual(JSON.parse(modelCalls[3].messages[1].content), app);
    assert.equal(follow.at(-1).saved.version.parent_id, requestId);
  });
});

test("invalid code gets one repair; repeated invalid output stays failed and is recoverable after reload", async () => {
  for (const succeeds of [true, false]) {
    let codes = 0;
    await withDatabase(
      async ({ request, db }) => {
        const output = await events(await generate(request(url, input)));
        assert.equal(codes, 2);
        assert.equal(output.at(-1).type, succeeds ? "complete" : "error");
        assert.equal(
          (await db.query("select * from public.versions")).rows.length,
          succeeds ? 1 : 0,
        );
        const snapshot = projectSnapshotSchema.parse(
          await (await getProject(request(projectUrl), context)).json(),
        );
        const recovery = recoverRequest(snapshot);
        if (!succeeds) {
          assert.equal(recovery!.status, "failed");
          assert.equal(recovery!.id, requestId);
          assert.equal(recovery!.prompt, input.prompt);
          assert.deepEqual(snapshot.messages[1].plan, plan.steps);
        }
      },
      {
        model: async (payload) => {
          const isPlan = payload.messages[0].content.startsWith(
            "Write a concise implementation plan",
          );
          if (!isPlan) codes++;
          if (codes === 2)
            assert.match(
              payload.messages[0].content,
              /previous output failed validation/,
            );
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    isPlan
                      ? plan
                      : codes === 2 && succeeds
                        ? app
                        : { ...app, javascript: "const broken = ;" },
                  ),
                },
              },
            ],
          });
        },
      },
    );
  }
});

test("missing unfinished reply cannot appear ready; active phases persist and expire after server restart", async () => {
  await withDatabase(async ({ request, rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_prompt: input.prompt,
      p_base_version_id: null,
      p_run_token: token,
      p_deadline_at: new Date(Date.now() + 60000).toISOString(),
    });
    await rpc("forge_advance_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_run_token: token,
      p_phase: 2,
      p_content: "Generating code",
      p_plan: plan.steps,
    });
    let snapshot = projectSnapshotSchema.parse(
      await (await getProject(request(projectUrl), context)).json(),
    );
    assert.equal(recoverRequest(snapshot)!.status, "processing");
    assert.equal(recoverRequest(snapshot)!.phase, 2);
    await db.exec(
      "update public.messages set deadline_at=clock_timestamp()-interval '1 second' where status='processing'",
    );
    snapshot = projectSnapshotSchema.parse(
      await (await getProject(request(projectUrl), context)).json(),
    );
    assert.equal(recoverRequest(snapshot)!.status, "failed");
    assert.match(recoverRequest(snapshot)!.error, /timed out/);
    assert.deepEqual(snapshot.messages[1].plan, plan.steps);
    assert.equal(
      (await events(await generate(request(url, input)))).at(-1).type,
      "complete",
    );
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      2,
      "retry reuses persisted placeholder",
    );
    await db.exec(
      "delete from public.versions; delete from public.messages where role='assistant'",
    );
    snapshot = projectSnapshotSchema.parse(
      await (await getProject(request(projectUrl), context)).json(),
    );
    assert.equal(recoverRequest(snapshot)!.status, "failed");
    assert.match(recoverRequest(snapshot)!.error, /interrupted/);
    assert.equal(
      (await events(await generate(request(url, input)))).at(-1).type,
      "complete",
      "orphan request can retry safely without duplicate user message",
    );
  });
});

test("fencing tokens reject late old writes after an expired attempt is reclaimed", async () => {
  await withDatabase(async ({ rpc, db, ownerId }) => {
    const token = randomUUID(),
      nextToken = randomUUID();
    const body = {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_prompt: input.prompt,
      p_base_version_id: null,
      p_run_token: token,
      p_deadline_at: new Date(Date.now() + 60000).toISOString(),
    };
    await rpc("forge_begin_generation", body);
    await db.exec(
      "update public.messages set deadline_at=clock_timestamp()-interval '1 second' where status='processing'",
    );
    await rpc("forge_begin_generation", { ...body, p_run_token: nextToken });
    await assert.rejects(
      rpc("forge_finish_generation", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_request_id: requestId,
        p_run_token: token,
        p_app: app,
        p_model: "test",
      }),
      /expired or superseded/,
    );
    const late = await rpc("forge_fail_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_run_token: token,
      p_code: "OLD",
      p_message: "Old failure",
    });
    assert.equal(late.state, "processing");
    const current = (
      await db.query<{ run_token: string }>(
        "select run_token from public.messages where role='assistant'",
      )
    ).rows[0];
    assert.equal(current.run_token, nextToken);
  });
});

test("deadline covers preparation, planning and saving; expired storage cannot create a version", async () => {
  for (const phase of ["begin", "model", "finish"]) {
    await withDatabase(
      async ({ request, db }) => {
        process.env.GENERATION_TIMEOUT_MS = "1000";
        const before = Date.now();
        const response = await generate(request(url, input));
        const failure = response.headers.get("content-type")?.includes("ndjson")
          ? (await events(response)).at(-1)
          : (await response.json()).error;
        assert.equal(failure.code, "GENERATION_TIMEOUT");
        assert(
          Date.now() - before < 1450,
          "request responds at shared deadline, without waiting for delayed work",
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
        assert.equal(
          (await db.query("select * from public.versions")).rows.length,
          0,
        );
      },
      {
        beforeFetch: async (location) => {
          if (
            (phase === "begin" &&
              location.pathname.endsWith("/forge_begin_generation")) ||
            (phase === "model" && location.hostname === "model.test") ||
            (phase === "finish" &&
              location.pathname.endsWith("/forge_finish_generation"))
          )
            await new Promise((resolve) => setTimeout(resolve, 1500));
        },
      },
    );
  }
});

test("committed save with lost response is recovered without converting success to failure", async () => {
  let rpcDone = false;
  await withDatabase(async ({ request, rpc, ownerId, db }) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const location = new URL(String(input));
      if (location.pathname.endsWith("/forge_finish_generation")) {
        const payload = JSON.parse(String(init?.body));
        await rpc("forge_finish_generation", payload);
        rpcDone = true;
        throw new TypeError("response lost after commit");
      }
      return originalFetch(input, init);
    };
    const output = await events(await generate(request(url, input)));
    assert(rpcDone);
    assert.equal(output.at(-1).type, "complete");
    const row = (
      await db.query<{ status: string; content: string }>(
        "select status,content from public.messages where role='assistant'",
      )
    ).rows[0];
    assert.equal(row.status, "completed");
    assert.match(row.content, /is ready/);
    const other = await rpc("forge_load_project", {
      p_owner_id: ownerId,
      p_project_id: projectId,
    });
    assert.equal((other.versions as unknown[]).length, 1);
  });
});

test("transport reconnects after a committed version loses its response without duplicating versions or model calls", async () => {
  await withDatabase(async ({ request, rpc, db, modelCalls }) => {
    const originalFetch = globalThis.fetch;
    let saves = 0;
    globalThis.fetch = async (input, init) => {
      if (
        new URL(String(input)).pathname.endsWith("/forge_finish_generation")
      ) {
        saves++;
        const saved = await rpc(
          "forge_finish_generation",
          JSON.parse(String(init?.body)),
        );
        if (saves === 1)
          throw new TypeError("fetch failed", {
            cause: Object.assign(new Error("response lost after commit"), {
              code: "ECONNRESET",
            }),
          });
        return Response.json(saved);
      }
      return originalFetch(input, init);
    };
    assert.equal(
      (await events(await generate(request(url, input)))).at(-1).type,
      "complete",
    );
    assert.equal(saves, 2);
    assert.equal(
      modelCalls.length,
      2,
      "reconnecting the save cannot repeat paid generation",
    );
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      2,
    );
  });
});

test("a lost project-insert response stays unconfirmed and reload finds exactly one new project", async () => {
  await withDatabase(async ({ request, db }) => {
    const originalFetch = globalThis.fetch;
    let inserts = 0;
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (
        new URL(String(input)).pathname.endsWith("/projects") &&
        init?.method === "POST"
      ) {
        inserts++;
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("response lost after commit"), {
            code: "ECONNRESET",
          }),
        });
      }
      return response;
    };
    const created = await createProject(
      request("http://localhost:3000/api/projects", { name: "New project" }),
    );
    assert.equal(created.status, 503);
    assert.equal(
      (await created.json()).error.code,
      "DATABASE_WRITE_UNCONFIRMED",
    );
    assert.equal(inserts, 1);
    const projects = await (
      await listProjects(request("http://localhost:3000/api/projects"))
    ).json();
    assert.equal(
      projects.filter(
        (project: { name: string }) => project.name === "New project",
      ).length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.projects")).rows.length,
      2,
      "the original project is retained",
    );
  });
});

test("restore reconciles a committed copy with a lost response without a second user-message read", async () => {
  await withDatabase(async ({ request, rpc, db, modelCalls }) => {
    await events(await generate(request(url, input)));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const location = new URL(String(input));
      if (location.pathname.endsWith("/forge_finish_generation")) {
        await rpc("forge_finish_generation", JSON.parse(String(init?.body)));
        throw new TypeError("response lost after restore commit");
      }
      assert(
        !location.pathname.endsWith("/messages"),
        "reuse the atomically claimed user message",
      );
      return originalFetch(input, init);
    };
    const restoredId = randomUUID();
    const response = await restore(
      request(`${projectUrl}/restore`, {
        versionId: requestId,
        requestId: restoredId,
        baseVersionId: requestId,
      }),
      context,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.version.id, restoredId);
    assert.equal(result.version.version_number, 2);
    assert.equal(result.userMessage.content, "Restore v1");
    assert.equal(result.message.status, "completed");
    assert.equal(modelCalls.length, 2, "restore does not call the model");
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      2,
    );
  });
});

test("restore appends an exact immutable copy, retries idempotently and cannot bypass an active generation", async () => {
  await withDatabase(async ({ request, db, modelCalls, rpc, ownerId }) => {
    await events(await generate(request(url, input)));
    const nextId = randomUUID();
    await events(
      await generate(
        request(url, {
          ...input,
          requestId: nextId,
          baseVersionId: requestId,
          prompt: "Dark mode",
        }),
      ),
    );
    const restoreId = randomUUID();
    const restoreInput = {
      versionId: requestId,
      requestId: restoreId,
      baseVersionId: nextId,
    };
    const response = await restore(
      request(`${projectUrl}/restore`, restoreInput),
      context,
    );
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.version.id, restoreId);
    assert.equal(saved.version.version_number, 3);
    assert.equal(saved.version.parent_id, nextId);
    for (const field of ["title", "html", "css", "javascript"] as const)
      assert.equal(saved.version[field], app[field]);
    const again = await restore(
      request(`${projectUrl}/restore`, restoreInput),
      context,
    );
    assert.equal((await again.json()).version.id, restoreId);
    assert.equal(modelCalls.length, 4);
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      3,
    );
    assert.equal(
      (
        await restore(
          request(`${projectUrl}/restore`, {
            ...restoreInput,
            requestId: randomUUID(),
          }),
          context,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await restore(
          request(`${projectUrl}/restore`, {
            ...restoreInput,
            versionId: randomUUID(),
            requestId: randomUUID(),
            baseVersionId: restoreId,
          }),
          context,
        )
      ).status,
      404,
    );
    await db.exec(
      "update public.versions set javascript='parent.document.title=1' where id='" +
        requestId +
        "'",
    );
    assert.equal(
      (
        await restore(
          request(`${projectUrl}/restore`, {
            ...restoreInput,
            requestId: randomUUID(),
            baseVersionId: restoreId,
          }),
          context,
        )
      ).status,
      422,
    );
    await rpc("forge_begin_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: randomUUID(),
      p_prompt: "Another update",
      p_base_version_id: restoreId,
      p_run_token: randomUUID(),
      p_deadline_at: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(
      (
        await restore(
          request(`${projectUrl}/restore`, {
            versionId: nextId,
            requestId: randomUUID(),
            baseVersionId: restoreId,
          }),
          context,
        )
      ).status,
      409,
    );
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      3,
    );
    assert.equal(modelCalls.length, 4);
  });
});

test("persistent owner/global generation budgets reject excessive paid calls before a model request", async () => {
  await withDatabase(async ({ request, rpc, ownerId, db, modelCalls }) => {
    const claim = await rpc("forge_begin_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_prompt: input.prompt,
      p_base_version_id: null,
      p_run_token: randomUUID(),
      p_deadline_at: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(claim.state, "claimed");
    await db.exec(
      "update public.messages set status='failed',run_token=null,attempts=10 where role='assistant'",
    );
    const response = await generate(
      request(url, { ...input, requestId: randomUUID() }),
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "DEMO_RATE_LIMIT");
    assert.equal(modelCalls.length, 0);
    await db.query("update public.projects set owner_id=$1 where id=$2", [
      randomUUID(),
      projectId,
    ]);
    await db.exec(
      "update public.messages set attempts=30 where role='assistant'",
    );
    const anotherId = randomUUID();
    await db.query(
      "insert into public.projects(id,name,owner_id) values($1,'Another owner',$2)",
      [anotherId, ownerId],
    );
    const globallyLimited = await generate(
      request(url, { ...input, projectId: anotherId, requestId: randomUUID() }),
    );
    assert.equal(globallyLimited.status, 429);
    assert.equal(
      modelCalls.length,
      0,
      "changing anonymous identity cannot bypass global budget",
    );
  });
});

test("deletion validates session, origin and ID and cannot delete another owner's project", async () => {
  await withDatabase(async ({ request, db }) => {
    const other = issueSession(new Request(url)).cookie!.split(";")[0];
    const crossOrigin = deletionRequest(request(projectUrl));
    crossOrigin.headers.set("Origin", "https://other.test");
    assert.equal((await deleteProject(crossOrigin, context)).status, 403);
    assert.equal(
      (
        await deleteProject(
          new Request(projectUrl, { method: "DELETE" }),
          context,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await deleteProject(deletionRequest(request(projectUrl)), {
          params: Promise.resolve({ projectId: "invalid" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await deleteProject(
          deletionRequest(request(projectUrl, undefined, other)),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (await db.query("select * from public.projects")).rows.length,
      1,
    );
  });
});

test("deletion removes empty projects and cascades all chat and linked source versions without touching other projects", async () => {
  await withDatabase(async ({ request, db, ownerId }) => {
    const retainedId = randomUUID();
    await db.query(
      "insert into public.projects(id,name,owner_id) values($1,'Keep me',$2)",
      [retainedId, ownerId],
    );
    assert.equal(
      (
        await deleteProject(
          deletionRequest(
            request(`http://localhost:3000/api/projects/${retainedId}`),
          ),
          { params: Promise.resolve({ projectId: retainedId }) },
        )
      ).status,
      204,
    );
    await db.query(
      "insert into public.projects(id,name,owner_id) values($1,'Keep me',$2)",
      [retainedId, ownerId],
    );
    await events(await generate(request(url, input)));
    await events(
      await generate(
        request(url, {
          ...input,
          requestId: randomUUID(),
          baseVersionId: requestId,
          prompt: "Make it green",
        }),
      ),
    );
    const response = await deleteProject(
      deletionRequest(request(projectUrl)),
      context,
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.versions")).rows.length,
      0,
    );
    assert.deepEqual((await db.query("select id from public.projects")).rows, [
      { id: retainedId },
    ]);
    assert.equal((await getProject(request(projectUrl), context)).status, 404);
    assert.equal(
      (await deleteProject(deletionRequest(request(projectUrl)), context))
        .status,
      404,
    );
  });
});

for (const operation of ["generate", "restore"]) {
  test(`deletion rejects active ${operation}, then allows expired requests and fences their late writes`, async () => {
    await withDatabase(async ({ request, rpc, ownerId, db }) => {
      await events(await generate(request(url, input)));
      const activeId = randomUUID();
      const runToken = randomUUID();
      await rpc("forge_begin_generation", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_request_id: activeId,
        p_prompt: operation === "restore" ? "Restore v1" : "Change the colour",
        p_base_version_id: requestId,
        p_run_token: runToken,
        p_deadline_at: new Date(Date.now() + 60000).toISOString(),
        p_operation: operation,
        p_source_version_id: operation === "restore" ? requestId : null,
      });
      const rejected = await deleteProject(
        deletionRequest(request(projectUrl)),
        context,
      );
      assert.equal(rejected.status, 409);
      assert.equal(
        (await rejected.json()).error.code,
        "GENERATION_IN_PROGRESS",
      );
      assert.equal(
        (await db.query("select * from public.versions")).rows.length,
        1,
      );
      await db.query(
        "update public.messages set deadline_at=clock_timestamp()-interval '1 second' where request_id=$1",
        [activeId],
      );
      assert.equal(
        (await deleteProject(deletionRequest(request(projectUrl)), context))
          .status,
        204,
      );
      await assert.rejects(
        rpc("forge_finish_generation", {
          p_owner_id: ownerId,
          p_project_id: projectId,
          p_request_id: activeId,
          p_run_token: runToken,
          p_app: app,
          p_model: "late-write",
        }),
        (error: unknown) => (error as { code: string }).code === "P0002",
      );
      assert.equal(
        (await db.query("select * from public.versions")).rows.length,
        0,
      );
    });
  });
}

test("deleting a project cannot reset owner or global generation budgets", async () => {
  await withDatabase(async ({ request, ownerId, db, modelCalls }) => {
    await events(await generate(request(url, input)));
    await db.exec(
      "update public.messages set attempts=10 where role='assistant'",
    );
    assert.equal(
      (await deleteProject(deletionRequest(request(projectUrl)), context))
        .status,
      204,
    );
    const nextId = randomUUID();
    await db.query(
      "insert into public.projects(id,name,owner_id) values($1,'New',$2)",
      [nextId, ownerId],
    );
    const nextInput = { ...input, projectId: nextId, requestId: randomUUID() };
    assert.equal((await generate(request(url, nextInput))).status, 429);
    await db.exec("update public.deleted_project_attempts set attempts=30");
    await db.query("update public.projects set owner_id=$1 where id=$2", [
      randomUUID(),
      nextId,
    ]);
    const other = issueSession(new Request(url)).cookie!.split(";")[0];
    const otherId = readSession(request(url, undefined, other))!;
    await db.query("update public.projects set owner_id=$1 where id=$2", [
      otherId,
      nextId,
    ]);
    assert.equal((await generate(request(url, nextInput, other))).status, 429);
    assert.equal(modelCalls.length, 2);
  });
});

test("browser database roles cannot call workflow RPCs or read business tables", async () => {
  await withDatabase(async ({ db }) => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{ rpc: boolean; table: boolean }>(
        "select has_function_privilege($1,'public.forge_begin_generation(uuid,uuid,uuid,text,uuid,uuid,timestamptz,text,uuid)','EXECUTE') as rpc,has_table_privilege($1,'public.projects','SELECT') as table",
        [role],
      );
      assert.equal(result.rows[0].rpc, false);
      assert.equal(result.rows[0].table, false);
      const deletion = await db.query<{ allowed: boolean; ledger: boolean }>(
        "select has_function_privilege($1,'public.forge_delete_project(uuid,uuid)','EXECUTE') as allowed,has_table_privilege($1,'public.deleted_project_attempts','SELECT') as ledger",
        [role],
      );
      assert.equal(deletion.rows[0].allowed, false);
      assert.equal(deletion.rows[0].ledger, false);
    }
    const old = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('service_role','public.forge_save_generation(uuid,uuid,text,uuid,jsonb,text)','EXECUTE') as allowed",
    );
    assert.equal(old.rows[0].allowed, false);
  });
});
