import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { test } from "node:test";
import {
  createStorageFetch,
  storageDispatcher,
} from "../src/lib/projects/transport";
import { databaseError, getSupabase } from "../src/lib/projects/server";

function failure(code: string) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("private upstream details"), { code }),
  });
}

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("explicit proxy works without Node startup flags and reuses its tunnel", async () => {
  const keys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const original = keys.map((key) => process.env[key]);
  const sockets = new Set<Socket>();
  let tunnels = 0;
  const upstream = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end("[]");
  });
  const proxy = createServer();
  for (const server of [upstream, proxy]) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
  }
  const upstreamPort = (upstream.address() as { port: number }).port;
  const proxyPort = (proxy.address() as { port: number }).port;
  proxy.on("connect", (_request, socket, head) => {
    tunnels++;
    const outbound = connect(upstreamPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) outbound.write(head);
      socket.pipe(outbound).pipe(socket);
    });
    sockets.add(outbound);
    outbound.on("error", () => socket.destroy());
    socket.on("error", () => outbound.destroy());
  });
  try {
    keys.forEach((key) => delete process.env[key]);
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
    const first = createStorageFetch();
    const second = createStorageFetch();
    for (const transport of [first, second, first, second, first, second]) {
      const response = await transport(
        `http://127.0.0.1:${upstreamPort}/rest/v1/projects`,
      );
      assert.deepEqual(await response.json(), []);
    }
    assert(
      tunnels <= 2,
      "six reads from different clients reuse the bounded connection pool",
    );
  } finally {
    await storageDispatcher().destroy();
    keys.forEach((key, i) => {
      if (original[i] === undefined) delete process.env[key];
      else process.env[key] = original[i];
    });
    sockets.forEach((socket) => socket.destroy());
    await Promise.all(
      [upstream, proxy].map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }
});

test("a dropped read is reconnected, with sanitized diagnostics", async () => {
  let attempts = 0;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await withFetch(
      async () => {
        if (++attempts === 1) throw failure("ECONNRESET");
        return Response.json([]);
      },
      async () => {
        assert.deepEqual(
          await (
            await createStorageFetch()(
              "https://database.test/rest/v1/projects?owner_id=private-owner",
              {
                headers: { apikey: "private-secret-key" },
              },
            )
          ).json(),
          [],
        );
      },
    );
    assert.equal(attempts, 2);
    assert.match(warnings.join(""), /ECONNRESET/);
    assert(
      !/private-owner|private-secret-key|private upstream/.test(
        warnings.join(""),
      ),
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("response body resets and temporary HTTP failures are retried for reads", async () => {
  for (const mode of ["body", "http"] as const) {
    let attempts = 0;
    await withFetch(
      async () => {
        if (++attempts === 1)
          return mode === "http"
            ? new Response("unavailable", { status: 503 })
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.error(failure("ECONNRESET"));
                  },
                }),
              );
        return Response.json([]);
      },
      async () => {
        assert.deepEqual(
          await (
            await createStorageFetch()("https://database.test/rest/v1/projects")
          ).json(),
          [],
        );
      },
    );
    assert.equal(attempts, 2);
  }
});

test("uncertain project creation, deletion and generation claims are never replayed", async () => {
  for (const path of [
    "projects",
    "rpc/forge_begin_generation",
    "rpc/forge_delete_project",
  ]) {
    let attempts = 0;
    await withFetch(
      async () => {
        attempts++;
        throw failure("ECONNRESET");
      },
      async () => {
        await assert.rejects(
          createStorageFetch()(`https://database.test/rest/v1/${path}`, {
            method: "POST",
            body: '{"id":"same-request"}',
          }),
          { name: "DATABASE_WRITE_UNCONFIRMED" },
        );
      },
    );
    assert.equal(attempts, 1);
  }
});

test("a connection failure before sending a write can reconnect without duplicating it", async () => {
  const bodies: (BodyInit | null | undefined)[] = [];
  await withFetch(
    async (_input, init) => {
      bodies.push(init?.body);
      if (bodies.length === 1) throw failure("UND_ERR_CONNECT_TIMEOUT");
      return Response.json({ id: "created-once" });
    },
    async () => {
      assert.equal(
        (
          await (
            await createStorageFetch()(
              "https://database.test/rest/v1/projects",
              {
                method: "POST",
                body: '{"name":"Counter"}',
              },
            )
          ).json()
        ).id,
        "created-once",
      );
    },
  );
  assert.deepEqual(bodies, ['{"name":"Counter"}', '{"name":"Counter"}']);
});

test("completed saves may be replayed with identical request IDs and bodies", async () => {
  const bodies: (BodyInit | null | undefined)[] = [];
  await withFetch(
    async (_input, init) => {
      bodies.push(init?.body);
      if (bodies.length === 1) throw failure("ECONNRESET");
      return Response.json({ version: { id: "same-version" } });
    },
    async () => {
      await createStorageFetch()(
        "https://database.test/rest/v1/rpc/forge_finish_generation",
        {
          method: "POST",
          body: '{"p_request_id":"same-version"}',
        },
      );
    },
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("a reset explicitly reported before TLS completes may reconnect a write", async () => {
  let attempts = 0;
  await withFetch(
    async () => {
      if (++attempts === 1)
        throw new TypeError("fetch failed", {
          cause: Object.assign(
            new Error(
              "Client network socket disconnected before secure TLS connection was established",
            ),
            { code: "ECONNRESET" },
          ),
        });
      return Response.json({ id: "created-once" });
    },
    async () => {
      assert.equal(
        (
          await (
            await createStorageFetch()(
              "https://database.test/rest/v1/projects",
              {
                method: "POST",
                body: '{"name":"Counter"}',
              },
            )
          ).json()
        ).id,
        "created-once",
      );
    },
  );
  assert.equal(attempts, 2);
});

test("authentication errors survive PostgREST wrapping and are never retried", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  const originals = keys.map((key) => process.env[key]);
  try {
    process.env.SUPABASE_URL = "https://database.test";
    process.env.SUPABASE_SECRET_KEY = "test-server-secret";
    for (const status of [401, 403]) {
      let attempts = 0;
      await withFetch(
        async () => {
          attempts++;
          return Response.json({ message: "private details" }, { status });
        },
        async () => {
          const result = await getSupabase().from("projects").select("id");
          assert.equal(databaseError(result.error).code, "DATABASE_AUTH_ERROR");
        },
      );
      assert.equal(attempts, 1);
    }
    assert.equal(databaseError({ code: "42501" }).code, "DATABASE_AUTH_ERROR");
  } finally {
    keys.forEach((key, i) => {
      if (originals[i] === undefined) delete process.env[key];
      else process.env[key] = originals[i];
    });
  }
});

test("persistent failures stop after three attempts and retain their category", async () => {
  let attempts = 0;
  await withFetch(
    async () => {
      attempts++;
      throw failure("UND_ERR_CONNECT_TIMEOUT");
    },
    async () => {
      await assert.rejects(
        createStorageFetch()("https://database.test/rest/v1/projects"),
        { name: "DATABASE_NETWORK_TIMEOUT" },
      );
    },
  );
  assert.equal(attempts, 3);
});

test("caller cancellation stops retries and permission failures stay distinct", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await withFetch(
    async () => {
      attempts++;
      controller.abort();
      throw failure("ECONNRESET");
    },
    async () => {
      await assert.rejects(
        createStorageFetch(controller.signal)(
          "https://database.test/rest/v1/projects",
        ),
        { name: "DATABASE_REQUEST_CANCELLED" },
      );
    },
  );
  assert.equal(attempts, 1);
  await withFetch(
    async () => {
      throw failure("EACCES");
    },
    async () => {
      await assert.rejects(
        createStorageFetch()("https://database.test/rest/v1/projects", {
          method: "POST",
        }),
        { name: "DATABASE_NETWORK_BLOCKED" },
      );
    },
  );
});
