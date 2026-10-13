import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { POST as generate } from "../src/app/api/generate/route";
import { GET as getProject } from "../src/app/api/projects/[projectId]/route";
import { generationEventSchema } from "../src/lib/generation/schema";
import { projectSnapshotSchema } from "../src/lib/projects/schema";
import { taskSpecSchema } from "../src/lib/generation/task";
import {
  app,
  plan,
  projectId,
  requestId,
  withDatabase,
} from "./helpers/database";

const url = "http://localhost:3000/api/generate";
const projectUrl = `http://localhost:3000/api/projects/${projectId}`;
const input = {
  projectId,
  requestId,
  prompt: "Build a counter",
  baseVersionId: null,
};
const task = taskSpecSchema.parse({
  version: "1",
  goal: "Build an interactive counter",
  requirements: ["Increment the visible count when the button is clicked"],
  data: [
    {
      name: "settings",
      fields: [
        { name: "label", type: "text", required: true },
        { name: "count", type: "number", required: true },
        { name: "enabled", type: "boolean", required: true },
        { name: "created", type: "date", required: false },
        {
          name: "status",
          type: "enum",
          required: true,
          options: ["active", "paused"],
        },
      ],
    },
  ],
  preserve: ["Keep the current count visible"],
  acceptance: [
    {
      id: "increment",
      name: "Increment the count",
      action: "Click Increment",
      expected: "The visible count increases by one",
      kind: "behavior",
    },
  ],
});

async function events(response: Response) {
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/x-ndjson/,
  );
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => generationEventSchema.parse(JSON.parse(line)));
}

test("structured task data reaches planning and generation, persists in snapshots, and replays without paid calls", async () => {
  await withDatabase(async ({ request, modelCalls }) => {
    const output = await events(
      await generate(request(url, { ...input, task })),
    );
    const final = output.at(-1)!;
    assert.equal(final.type, "complete");
    if (final.type !== "complete") assert.fail("Expected a saved result");
    assert.deepEqual(final.saved.message.task_contract, task);
    assert.equal(modelCalls.length, 2);
    for (const call of modelCalls)
      assert.deepEqual(JSON.parse(call.messages.at(-1)!.content).task, task);
    const snapshot = projectSnapshotSchema.parse(
      await (
        await getProject(request(projectUrl), {
          params: Promise.resolve({ projectId }),
        })
      ).json(),
    );
    assert.deepEqual(
      snapshot.messages.map((message) => message.task_contract),
      [task, task],
    );
    const status = projectSnapshotSchema.parse(
      await (
        await getProject(request(`${projectUrl}?view=status`), {
          params: Promise.resolve({ projectId }),
        })
      ).json(),
    );
    assert.deepEqual(
      status.messages.map((message) => message.task_contract),
      [task, task],
    );
    const replay = await events(await generate(request(url, input)));
    assert.equal(replay.at(-1)!.type, "complete");
    assert.equal(modelCalls.length, 2);
    const changed = await generate(
      request(url, {
        ...input,
        task: { ...task, goal: "Change the immutable goal" },
      }),
    );
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error.code, "REQUEST_ID_CONFLICT");
    assert.equal(modelCalls.length, 2);
  });
});

test("a processing task rejects changed same-ID contracts and returns its original task when omitted", async () => {
  let reached!: () => void;
  let release!: () => void;
  const planning = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withDatabase(
    async ({ request, modelCalls }) => {
      const first = await generate(request(url, { ...input, task }));
      const firstBody = events(first);
      await planning;
      try {
        const changed = await generate(
          request(url, {
            ...input,
            task: { ...task, requirements: ["Different requirements"] },
          }),
        );
        assert.equal(changed.status, 409);
        assert.equal((await changed.json()).error.code, "REQUEST_ID_CONFLICT");
        const duplicate = await generate(request(url, input));
        assert.equal(duplicate.status, 202);
        const pending = await duplicate.json();
        assert.deepEqual(pending.message.task_contract, task);
        assert.deepEqual(pending.userMessage.task_contract, task);
        assert.equal(modelCalls.length, 1);
      } finally {
        release();
      }
      assert.equal((await firstBody).at(-1)!.type, "complete");
      assert.equal(modelCalls.length, 2);
    },
    {
      model: async (payload) => {
        const isPlan = payload.messages[0].content.startsWith(
          "Write a concise implementation plan",
        );
        if (isPlan) {
          reached();
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

test("failed-task retry without client task preserves its original contract and reports a structured validation failure", async () => {
  let codeCalls = 0;
  await withDatabase(
    async ({ request, modelCalls, db }) => {
      const failed = await events(
        await generate(request(url, { ...input, task })),
      );
      const failure = failed.at(-1)!;
      assert.equal(failure.type, "error");
      if (failure.type !== "error")
        assert.fail("Expected a validation failure");
      assert.equal(failure.code, "INVALID_GENERATED_APP");
      assert.equal(failure.failure?.tool, "validate_app");
      assert.equal(failure.failure?.outcome, "failed");
      assert.equal(
        failure.failure?.recovery,
        "none",
        "the single repair has already been used",
      );
      assert.equal(modelCalls.length, 3);
      const retry = await events(await generate(request(url, input)));
      assert.equal(retry.at(-1)!.type, "complete");
      for (const call of modelCalls)
        assert.deepEqual(JSON.parse(call.messages.at(-1)!.content).task, task);
      assert.deepEqual(
        (
          await db.query<{ task_contract: unknown }>(
            "select task_contract from public.messages order by seq",
          )
        ).rows.map((row) => row.task_contract),
        [task, task],
      );
      assert.equal(
        (
          await db.query<{ attempts: number }>(
            "select attempts from public.messages where role='assistant'",
          )
        ).rows[0].attempts,
        2,
      );
    },
    {
      model: async (payload) => {
        const isPlan = payload.messages[0].content.startsWith(
          "Write a concise implementation plan",
        );
        if (!isPlan) codeCalls++;
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  isPlan
                    ? plan
                    : codeCalls <= 2
                      ? { ...app, javascript: "const invalid = ;" }
                      : app,
                ),
              },
            },
          ],
        });
      },
    },
  );
});

test("clients cannot grant permissions, enlarge budgets, inject tools or bypass strict task data limits", async () => {
  await withDatabase(async ({ request, modelCalls, db }) => {
    const invalidPayloads = [
      { ...input, task, permissions: ["model:invoke"] },
      { ...input, task, budget: { maxModelCalls: 100 } },
      { ...input, task, authority: { ownerId: "client supplied" } },
      { ...input, task, tools: [{ name: "shell" }] },
      { ...input, task: { ...task, permissions: ["network"] } },
      { ...input, task: { ...task, budget: { maxRepairs: 99 } } },
      {
        ...input,
        task: {
          ...task,
          data: [
            {
              name: "items",
              fields: [
                {
                  name: "status",
                  type: "enum",
                  required: true,
                  options: ["same", "same"],
                },
              ],
            },
          ],
        },
      },
      {
        ...input,
        task: {
          ...task,
          data: [
            {
              name: "items",
              fields: [
                {
                  name: "status",
                  type: "enum",
                  required: true,
                  options: Array.from({ length: 13 }, (_, i) => String(i)),
                },
              ],
            },
          ],
        },
      },
      {
        ...input,
        task: {
          ...task,
          data: [
            {
              name: "items",
              fields: [
                {
                  name: "status",
                  type: "enum",
                  required: true,
                  options: ["active"],
                  permission: "write",
                },
              ],
            },
          ],
        },
      },
      {
        ...input,
        task: { ...task, acceptance: [task.acceptance[0], task.acceptance[0]] },
      },
    ];
    for (const payload of invalidPayloads) {
      const response = await generate(request(url, payload));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
    }
    assert.equal(modelCalls.length, 0);
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      0,
      "invalid client authority never claims work",
    );
  });
});

test("missing task migration prevents paid model calls and fails the claimed attempt", async () => {
  await withDatabase(
    async ({ request, modelCalls, db }) => {
      const response = await generate(request(url, { ...input, task }));
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json()).error.code,
        "DATABASE_SCHEMA_MISSING",
      );
      assert.equal(modelCalls.length, 0);
      const message = (
        await db.query<{ status: string; task_contract: unknown }>(
          "select status,task_contract from public.messages where role='assistant'",
        )
      ).rows[0];
      assert.equal(message.status, "failed");
      assert.equal(message.task_contract, null);
    },
    {
      beforeFetch: async (location) =>
        location.pathname.endsWith("/forge_bind_task_contract")
          ? Response.json(
              { code: "PGRST202", message: "Function unavailable" },
              { status: 404 },
            )
          : undefined,
    },
  );
});

test("provider failures expose tool, outcome and recovery without leaking provider response secrets", async () => {
  const secret = "sk-secret-provider-body-never-echo";
  await withDatabase(
    async ({ request, modelCalls, db }) => {
      const output = await events(
        await generate(request(url, { ...input, task })),
      );
      const failure = output.at(-1)!;
      assert.equal(failure.type, "error");
      if (failure.type !== "error") assert.fail("Expected a provider failure");
      assert.equal(failure.code, "PROVIDER_AUTH_ERROR");
      assert.equal(failure.failure?.tool, "plan_app");
      assert.equal(failure.failure?.status, 502);
      assert.equal(failure.failure?.outcome, "failed");
      assert.equal(failure.failure?.recovery, "retry_request");
      assert.equal(modelCalls.length, 1);
      assert(!JSON.stringify(output).includes(secret));
      assert(!JSON.stringify(output).includes("test-model-key"));
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from public.messages where role='assistant'",
          )
        ).rows[0].status,
        "failed",
      );
    },
    {
      model: async () =>
        Response.json({ error: { message: secret } }, { status: 401 }),
    },
  );
});

test("a changed task on failed retry releases the new claim without paid calls and preserves recovery", async () => {
  let codeCalls = 0;
  await withDatabase(
    async ({ request, modelCalls, db }) => {
      const failed = await events(
        await generate(request(url, { ...input, task })),
      );
      assert.equal(failed.at(-1)!.type, "error");
      assert.equal(modelCalls.length, 3);
      const conflict = await generate(
        request(url, {
          ...input,
          task: { ...task, goal: "Replace the original failed task" },
        }),
      );
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).error.code, "REQUEST_ID_CONFLICT");
      assert.equal(
        modelCalls.length,
        3,
        "rejecting a changed retry cannot repeat model work",
      );
      const rejected = (
        await db.query<{
          status: string;
          task_contract: unknown;
          run_token: string | null;
        }>(
          "select status,task_contract,run_token from public.messages where role='assistant'",
        )
      ).rows[0];
      assert.equal(
        rejected.status,
        "failed",
        "the rejected retry must not strand a processing claim",
      );
      assert.equal(rejected.run_token, null);
      assert.deepEqual(rejected.task_contract, task);
      const recovered = await events(
        await generate(request(url, { ...input, task })),
      );
      const final = recovered.at(-1)!;
      assert.equal(final.type, "complete");
      if (final.type !== "complete")
        assert.fail("Expected successful recovery");
      assert.deepEqual(final.saved.message.task_contract, task);
      assert.equal(modelCalls.length, 5);
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
        if (!isPlan) codeCalls++;
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  isPlan
                    ? plan
                    : codeCalls <= 2
                      ? { ...app, javascript: "const invalid = ;" }
                      : app,
                ),
              },
            },
          ],
        });
      },
    },
  );
});

test("completed legacy requests replay without a task but cannot acquire a different structured contract", async () => {
  await withDatabase(async ({ request, rpc, ownerId, db, modelCalls }) => {
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
    await rpc("forge_finish_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_run_token: token,
      p_app: app,
      p_model: "legacy-test",
    });
    const before = (await db.query("select * from public.versions")).rows;
    const replay = await events(await generate(request(url, input)));
    const final = replay.at(-1)!;
    assert.equal(final.type, "complete");
    if (final.type !== "complete") assert.fail("Expected legacy replay");
    assert.equal(final.saved.message.task_contract, null);
    const conflict = await generate(request(url, { ...input, task }));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "REQUEST_ID_CONFLICT");
    assert.equal(modelCalls.length, 0);
    assert.deepEqual(
      (await db.query("select * from public.versions")).rows,
      before,
    );
    const legacy = (
      await db.query<{ status: string; task_contract: unknown }>(
        "select status,task_contract from public.messages where role='assistant'",
      )
    ).rows[0];
    assert.equal(legacy.status, "completed");
    assert.equal(legacy.task_contract, null);
  });
});
