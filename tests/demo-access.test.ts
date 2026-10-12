import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST, DELETE } from "../src/app/api/access/route";
import { proxy } from "../src/proxy";
import {
  assertDemoAccess,
  issueDemoAccess,
} from "../src/lib/projects/demo-access";
import { issueSession, readSession } from "../src/lib/projects/session";
import { loginDestination } from "../src/lib/login-path";

const url = "https://forge.test/api/access";
const password = "test-demo-password-123";
const username = "forge-user";
const keys = [
  "FORGE_DEPLOYMENT",
  "FORGE_SESSION_SECRET",
  "DEMO_ACCESS_PASSWORD",
  "FORGE_LOGIN_USERNAME",
];
let original: (string | undefined)[];
beforeEach(() => {
  original = keys.map((key) => process.env[key]);
  process.env.FORGE_DEPLOYMENT = "public";
  process.env.FORGE_SESSION_SECRET = "test-signing-secret-32-characters-long";
  process.env.DEMO_ACCESS_PASSWORD = password;
  process.env.FORGE_LOGIN_USERNAME = username;
});
afterEach(() =>
  keys.forEach((key, i) => {
    if (original[i] === undefined) delete process.env[key];
    else process.env[key] = original[i];
  }),
);
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forge.test",
      ...headers,
    },
    body: JSON.stringify(
      body && typeof body === "object" ? { username, ...body } : body,
    ),
  });
}
function accessCookie() {
  return issueDemoAccess(new Request(url), username, password)!.split(";")[0];
}

test("login sets a signed private access cookie and rejects wrong passwords without a browser challenge", async () => {
  const denied = await POST(request({ password: "wrong" }));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("set-cookie"), null);
  assert.equal(denied.headers.get("www-authenticate"), null);
  const wrongUsername = await POST(
    request({ username: "wrong-user", password }),
  );
  assert.equal(wrongUsername.status, 401);
  assert.deepEqual(await wrongUsername.json(), await denied.json());
  const accepted = await POST(request({ password }));
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=604800; Secure$/);
  assert(!cookie.includes(password));
  assert.equal(accepted.headers.get("cache-control"), "private, no-store");
  assert.doesNotThrow(() =>
    assertDemoAccess(
      new Request(url, { headers: { Cookie: cookie.split(";")[0] } }),
    ),
  );
});

test("tampered, expired and rotated credentials cannot reuse an access cookie", () => {
  const cookie = accessCookie();
  const checked = (value: string) =>
    assertDemoAccess(new Request(url, { headers: { Cookie: value } }));
  assert.throws(() => checked(cookie + "x"), /Sign in/);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 8 * 24 * 60 * 60 * 1000;
    assert.throws(() => checked(cookie), /Sign in/);
  } finally {
    Date.now = originalNow;
  }
  process.env.DEMO_ACCESS_PASSWORD = "rotated-demo-password";
  assert.throws(() => checked(cookie), /Sign in/);
  process.env.DEMO_ACCESS_PASSWORD = password;
  process.env.FORGE_LOGIN_USERNAME = "rotated-user";
  assert.throws(() => checked(cookie), /Sign in/);
  process.env.FORGE_LOGIN_USERNAME = username;
  process.env.FORGE_SESSION_SECRET = "another-test-secret-32-characters-long";
  assert.throws(() => checked(cookie), /Sign in/);
});

test("logging out and back in preserves the browser's project ownership identity", async () => {
  const access = accessCookie();
  const initial = issueSession(
    new Request(url, { headers: { Cookie: access } }),
  );
  const identity = initial.cookie!.split(";")[0];
  const signedOut = await DELETE(
    new Request(url, {
      method: "DELETE",
      headers: { Origin: "https://forge.test" },
    }),
  );
  assert.match(
    signedOut.headers.get("set-cookie")!,
    /^forge_access=;.*Max-Age=0/,
  );
  assert(!signedOut.headers.get("set-cookie")!.includes("forge_session"));
  assert.equal(
    readSession(new Request(url, { headers: { Cookie: identity } })),
    initial.id,
  );
  assert.throws(
    () => assertDemoAccess(new Request(url, { headers: { Cookie: identity } })),
    /Sign in/,
  );
  const resumed = issueSession(
    new Request(url, { headers: { Cookie: `${identity}; ${accessCookie()}` } }),
  );
  assert.equal(resumed.id, initial.id);
  assert.equal(resumed.cookie, null);
});

test("public homepage and login render while private APIs still require access", () => {
  for (const path of ["/", "/?project=private-id", "/login", "/api/access"]) {
    assert.equal(
      proxy(new NextRequest(`https://forge.test${path}`)).headers.get(
        "x-middleware-next",
      ),
      "1",
    );
  }
  const privateResponse = proxy(
    new NextRequest("https://forge.test/api/projects"),
  );
  assert.equal(privateResponse.status, 401);
  assert.equal(privateResponse.headers.get("www-authenticate"), null);
  assert.equal(
    proxy(
      new NextRequest("https://forge.test/api/projects", {
        headers: { Cookie: accessCookie() },
      }),
    ).headers.get("x-middleware-next"),
    "1",
  );
  const redirect = proxy(
    new NextRequest("https://forge.test/private?view=one"),
  );
  assert.equal(new URL(redirect.headers.get("location")!).pathname, "/login");
  assert.equal(
    new URL(redirect.headers.get("location")!).searchParams.get("next"),
    "/private?view=one",
  );
});

test("login rejects cross-origin, malformed, oversized and misconfigured requests", async () => {
  assert.equal(
    (await POST(request({ password }, { Origin: "https://attacker.test" })))
      .status,
    403,
  );
  assert.equal(
    (
      await DELETE(
        new Request(url, {
          method: "DELETE",
          headers: { Origin: "https://attacker.test" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await POST(request({ password }, { "Content-Type": "text/plain" })))
      .status,
    415,
  );
  assert.equal((await POST(request({ password: 42 }))).status, 400);
  assert.equal(
    (await POST(request({ username: undefined, password }))).status,
    400,
  );
  assert.equal((await POST(request({ username: " ", password }))).status, 400);
  assert.equal(
    (await POST(request({ password: "x".repeat(9000) }))).status,
    413,
  );
  assert.equal(
    (
      await POST(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
      )
    ).status,
    400,
  );
  delete process.env.FORGE_SESSION_SECRET;
  assert.equal((await POST(request({ password }))).status, 503);
  assert.equal(
    proxy(new NextRequest("https://forge.test/api/projects")).status,
    503,
  );
});

test("login return URLs stay within the product and cannot loop back to login", () => {
  for (const value of [
    undefined,
    "",
    "https://attacker.test",
    "//attacker.test",
    "/\\attacker.test",
    "/login?next=/",
    "/private/../login",
    "/login/",
    "/\n/attacker.test",
  ])
    assert.equal(loginDestination(value), "/");
  assert.equal(loginDestination("/?project=saved-id"), "/?project=saved-id");
});
