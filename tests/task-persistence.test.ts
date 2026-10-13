import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { taskSpecSchema } from "../src/lib/generation/task";
import {
  messageSchema,
  projectSnapshotSchema,
} from "../src/lib/projects/schema";
import { app, projectId, requestId, withDatabase } from "./helpers/database";

const task = taskSpecSchema.parse({
  version: "1",
  goal: "Add status filters",
  requirements: ["Filter records by status"],
  data: [],
  preserve: ["Keep saved records"],
  acceptance: [
    {
      id: "filter_status",
      name: "Filter status",
      action: "Select completed",
      expected: "Only completed records appear",
      kind: "behavior",
    },
  ],
});

test("task-contract migration can be applied again without changing existing data", async () => {
  await withDatabase(async ({ db }) => {
    await db.exec(
      await readFile("supabase/migrations/004_task_contract.sql", "utf8"),
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from pg_constraint where conname='messages_task_contract_check' and conrelid='public.messages'::regclass",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from public.projects",
        )
      ).rows[0].count,
      1,
    );
  });
});

function beginParams(ownerId: string, token: string) {
  return {
    p_owner_id: ownerId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_prompt: "Add status filters",
    p_base_version_id: null,
    p_run_token: token,
    p_deadline_at: new Date(Date.now() + 60000).toISOString(),
  };
}

function bindParams(ownerId: string, token: string, contract: unknown = task) {
  return {
    p_owner_id: ownerId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_run_token: token,
    p_task_contract: contract,
  };
}

const hasCode = (code: string) => (error: unknown) =>
  (error as { code?: string }).code === code;

test("legacy messages remain nullable; binding saves both task contracts and is idempotent without model calls", async () => {
  await withDatabase(async ({ rpc, ownerId, db, modelCalls }) => {
    const token = randomUUID();
    const claimed = await rpc(
      "forge_begin_generation",
      beginParams(ownerId, token),
    );
    assert.equal(messageSchema.parse(claimed.message).task_contract, null);
    assert.equal(messageSchema.parse(claimed.userMessage).task_contract, null);
    const bound = await rpc(
      "forge_bind_task_contract",
      bindParams(ownerId, token),
    );
    const message = messageSchema.parse(bound);
    assert.deepEqual(message.task_contract, task);
    const first = await db.query("select * from public.projects where id=$1", [
      projectId,
    ]);
    assert.deepEqual(
      await rpc("forge_bind_task_contract", bindParams(ownerId, token)),
      bound,
    );
    const after = await db.query("select * from public.projects where id=$1", [
      projectId,
    ]);
    assert.deepEqual(
      after.rows,
      first.rows,
      "idempotent binding does not write again",
    );
    const contracts = await db.query<{
      task_contract: unknown;
      attempts: number;
    }>("select task_contract,attempts from public.messages order by seq");
    assert.deepEqual(
      contracts.rows.map((row) => row.task_contract),
      [task, task],
    );
    assert.equal(contracts.rows[1].attempts, 1);
    assert.equal(modelCalls.length, 0);
  });
});

test("task binding scopes owner, project and request before any write", async () => {
  await withDatabase(async ({ rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    for (const replacement of [
      { p_owner_id: randomUUID() },
      { p_project_id: randomUUID() },
      { p_request_id: randomUUID() },
    ])
      await assert.rejects(
        rpc("forge_bind_task_contract", {
          ...bindParams(ownerId, token),
          ...replacement,
        }),
        hasCode("P0002"),
      );
    assert.deepEqual(
      (
        await db.query<{ task_contract: unknown }>(
          "select task_contract from public.messages",
        )
      ).rows.map((row) => row.task_contract),
      [null, null],
    );
  });
});

test("task binding rejects wrong or absent fencing tokens and expired or failed attempts", async () => {
  await withDatabase(async ({ rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    for (const invalidToken of [randomUUID(), null])
      await assert.rejects(
        rpc("forge_bind_task_contract", {
          ...bindParams(ownerId, token),
          p_run_token: invalidToken,
        }),
        hasCode("57014"),
      );
    await db.exec(
      "update public.messages set deadline_at=clock_timestamp()-interval '1 second' where role='assistant'",
    );
    const before = (await db.query("select updated_at from public.projects"))
      .rows;
    await assert.rejects(
      rpc("forge_bind_task_contract", bindParams(ownerId, token)),
      hasCode("57014"),
    );
    assert.deepEqual(
      (await db.query("select updated_at from public.projects")).rows,
      before,
    );
    await db.exec(
      "update public.messages set status='failed',deadline_at=clock_timestamp()+interval '60 seconds' where role='assistant'",
    );
    await assert.rejects(
      rpc("forge_bind_task_contract", bindParams(ownerId, token)),
      hasCode("57014"),
    );
    assert.deepEqual(
      (
        await db.query<{ task_contract: unknown }>(
          "select task_contract from public.messages",
        )
      ).rows.map((row) => row.task_contract),
      [null, null],
    );
  });
});

test("failed retries retain an immutable task and reject old tokens or changed contracts", async () => {
  await withDatabase(async ({ rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    await rpc("forge_bind_task_contract", bindParams(ownerId, token));
    await rpc("forge_fail_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_run_token: token,
      p_code: "INVALID_OUTPUT",
      p_message: "Try again",
    });
    const nextToken = randomUUID();
    const retry = await rpc(
      "forge_begin_generation",
      beginParams(ownerId, nextToken),
    );
    assert.equal(retry.state, "claimed");
    assert.deepEqual(messageSchema.parse(retry.message).task_contract, task);
    assert.deepEqual(
      messageSchema.parse(retry.userMessage).task_contract,
      task,
    );
    await assert.rejects(
      rpc("forge_bind_task_contract", bindParams(ownerId, token)),
      hasCode("57014"),
    );
    await assert.rejects(
      rpc(
        "forge_bind_task_contract",
        bindParams(ownerId, nextToken, { ...task, goal: "A changed goal" }),
      ),
      hasCode("P0409"),
    );
    assert.deepEqual(
      messageSchema.parse(
        await rpc("forge_bind_task_contract", bindParams(ownerId, nextToken)),
      ).task_contract,
      task,
    );
    assert.deepEqual(
      (
        await db.query<{ task_contract: unknown }>(
          "select task_contract from public.messages",
        )
      ).rows.map((row) => row.task_contract),
      [task, task],
    );
  });
});

test("processing and completed replay plus status snapshots expose the persisted contract", async () => {
  await withDatabase(async ({ rpc, ownerId }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    await rpc("forge_bind_task_contract", bindParams(ownerId, token));
    const active = await rpc(
      "forge_begin_generation",
      beginParams(ownerId, randomUUID()),
    );
    assert.equal(active.state, "processing");
    assert.deepEqual(messageSchema.parse(active.message).task_contract, task);
    assert.deepEqual(
      messageSchema.parse(active.userMessage).task_contract,
      task,
    );
    const status = projectSnapshotSchema.parse(
      await rpc("forge_load_project", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_status_only: true,
      }),
    );
    assert.deepEqual(
      status.messages.map((message) => message.task_contract),
      [task, task],
    );
    const saved = await rpc("forge_finish_generation", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_request_id: requestId,
      p_run_token: token,
      p_app: app,
      p_model: "test",
    });
    assert.deepEqual(messageSchema.parse(saved.message).task_contract, task);
    const replay = await rpc(
      "forge_begin_generation",
      beginParams(ownerId, randomUUID()),
    );
    assert.equal(replay.state, "completed");
    assert.deepEqual(
      messageSchema.parse((replay.saved as Record<string, unknown>).message)
        .task_contract,
      task,
    );
    assert.deepEqual(
      messageSchema.parse(replay.userMessage).task_contract,
      task,
    );
    await assert.rejects(
      rpc("forge_bind_task_contract", bindParams(ownerId, token)),
      hasCode("57014"),
    );
  });
});

test("deadline expiration during binding rolls back both messages and project touch writes", async () => {
  await withDatabase(async ({ rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    const before = (await db.query("select updated_at from public.projects"))
      .rows;
    await db.exec(`
      create function public.forge_test_expire_task() returns trigger language plpgsql as $$
      begin
        if new.role='assistant' and new.task_contract is not null then
          new.deadline_at:=clock_timestamp()-interval '1 second';
        end if;
        return new;
      end; $$;
      create trigger forge_test_expire_task before update on public.messages
      for each row execute function public.forge_test_expire_task();
    `);
    try {
      await assert.rejects(
        rpc("forge_bind_task_contract", bindParams(ownerId, token)),
        hasCode("57014"),
      );
      assert.deepEqual(
        (
          await db.query<{ task_contract: unknown }>(
            "select task_contract from public.messages",
          )
        ).rows.map((row) => row.task_contract),
        [null, null],
      );
      assert.deepEqual(
        (await db.query("select updated_at from public.projects")).rows,
        before,
      );
    } finally {
      await db.exec(
        "drop trigger forge_test_expire_task on public.messages; drop function public.forge_test_expire_task()",
      );
    }
  });
});

test("database contract envelopes reject wrong type, version and byte length", async () => {
  await withDatabase(async ({ rpc, ownerId, db }) => {
    const token = randomUUID();
    await rpc("forge_begin_generation", beginParams(ownerId, token));
    for (const invalid of [
      null,
      [],
      {},
      { version: "2" },
      { version: 1 },
      { version: "1", data: "界".repeat(22000) },
    ]) {
      await assert.rejects(
        rpc("forge_bind_task_contract", bindParams(ownerId, token, invalid)),
        hasCode("22023"),
      );
      await assert.rejects(
        db.query(
          "update public.messages set task_contract=$1::jsonb where role='assistant'",
          [JSON.stringify(invalid)],
        ),
        hasCode("23514"),
      );
    }
    await db.exec("update public.messages set task_contract=null");
    assert.equal(
      (
        await db.query<{ task_contract: unknown }>(
          "select task_contract from public.messages where role='assistant'",
        )
      ).rows[0].task_contract,
      null,
    );
  });
});

test("browser roles cannot execute binding or write contracts; only service role is granted access", async () => {
  await withDatabase(async ({ db }) => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{
        execute: boolean;
        update: boolean;
        insert: boolean;
      }>(
        "select has_function_privilege($1,'public.forge_bind_task_contract(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') as execute,has_column_privilege($1,'public.messages','task_contract','UPDATE') as update,has_column_privilege($1,'public.messages','task_contract','INSERT') as insert",
        [role],
      );
      assert.deepEqual(result.rows[0], {
        execute: false,
        update: false,
        insert: false,
      });
      try {
        await db.exec(`set role ${role}`);
        await assert.rejects(
          db.query(
            "select public.forge_bind_task_contract($1,$2,$3,$4,$5::jsonb)",
            [
              randomUUID(),
              projectId,
              requestId,
              randomUUID(),
              JSON.stringify(task),
            ],
          ),
          hasCode("42501"),
        );
        await assert.rejects(
          db.query("update public.messages set task_contract=$1::jsonb", [
            JSON.stringify(task),
          ]),
          hasCode("42501"),
        );
      } finally {
        await db.exec("reset role");
      }
    }
    const service = await db.query<{ execute: boolean; definer: boolean }>(
      "select has_function_privilege('service_role','public.forge_bind_task_contract(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') as execute,(select prosecdef from pg_proc where oid='public.forge_bind_task_contract(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) as definer",
    );
    assert.deepEqual(service.rows[0], { execute: true, definer: true });
  });
});
