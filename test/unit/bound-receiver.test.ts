import { afterAll, afterEach, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { signInternalRequest } from "../../src/infra/security/internal-request";
import { requireInternalServiceAuth } from "../../src/middleware/internal-service-auth";

const savedTrust = process.env.INTERNAL_REQUEST_TRUST_FILE;
const savedLegacy = process.env.INTERNAL_SERVICE_TOKEN;
const directory = mkdtempSync(join(tmpdir(), "receiver-fixture-"));
const trustFile = join(directory, "trust.json");
const gateway = generateKeyPairSync("ed25519");
const sibling = generateKeyPairSync("ed25519");
const trust = [
  {
    issuer: "gateway",
    keyId: "g1",
    publicKey: gateway.publicKey.export({ type: "spki", format: "pem" }),
  },
  {
    issuer: "cms",
    keyId: "c1",
    publicKey: sibling.publicKey.export({ type: "spki", format: "pem" }),
  },
];
writeFileSync(trustFile, JSON.stringify(trust));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
afterEach(() => {
  if (savedTrust === undefined) delete process.env.INTERNAL_REQUEST_TRUST_FILE;
  else process.env.INTERNAL_REQUEST_TRUST_FILE = savedTrust;
  if (savedLegacy === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
  else process.env.INTERNAL_SERVICE_TOKEN = savedLegacy;
});

function fixture() {
  process.env.INTERNAL_REQUEST_TRUST_FILE = trustFile;
  process.env.INTERNAL_SERVICE_TOKEN = "shared-static-fixture";
  const app = new Hono<{ Variables: { requestId: string } }>();
  let calls = 0;
  app.use("*", requireInternalServiceAuth());
  app.post("/internal/cms-actions", async (c) => {
    calls++;
    return c.json({
      body: await c.req.json(),
      actor: c.req.header("X-XS-User-Id"),
      workspace: c.req.header("X-Workspace-Id"),
      requestId: c.get("requestId"),
    });
  });
  const request = (
    issuer = "gateway",
    operation = "cms.entry.create",
    payload: unknown = {},
  ) => {
    const url = "http://receiver/internal/cms-actions";
    const body = JSON.stringify({ actionKey: operation, payload });
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Request-Id": "receiver-request",
      "X-XS-User-Id": "actor-a",
      "X-Workspace-Id": "tenant-a",
    });
    const signer =
      issuer === "gateway"
        ? { issuer, keyId: "g1", privateKey: gateway.privateKey }
        : { issuer, keyId: "c1", privateKey: sibling.privateKey };
    headers.set(
      "X-Internal-Service-Token",
      signInternalRequest(
        {
          audience: "cms-service",
          operation,
          url,
          method: "POST",
          headers,
          body,
        },
        signer,
      ),
    );
    return { url, body, headers };
  };
  const send = (r: ReturnType<typeof request>) =>
    app.request(r.url, { method: "POST", headers: r.headers, body: r.body });
  return { app, request, send, calls: () => calls };
}

test("accepts bound gateway bytes and preserves the signed route context", async () => {
  const f = fixture();
  const r = f.request();
  const response = await f.send(r);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    body: { actionKey: "cms.entry.create", payload: {} },
    actor: "actor-a",
    workspace: "tenant-a",
    requestId: "receiver-request",
  });
  expect(f.calls()).toBe(1);
});

test("rejects legacy credentials, trusted siblings, unknown operations and substituted context before dispatch", async () => {
  const f = fixture();
  const legacy = f.request();
  legacy.headers.set("X-Internal-Service-Token", "shared-static-fixture");
  expect((await f.send(legacy)).status).toBe(403);
  expect((await f.send(f.request("cms"))).status).toBe(403);
  expect((await f.send(f.request("gateway", "unknown.action"))).status).toBe(
    403,
  );
  expect(
    (
      await f.send(
        f.request("gateway", "cms.entry.create", { workspaceId: "tenant-b" }),
      )
    ).status,
  ).toBe(403);
  for (const header of ["X-Workspace-Id", "X-XS-User-Id", "X-Request-Id"]) {
    const changed = f.request();
    changed.headers.set(header, "substitute");
    expect((await f.send(changed)).status).toBe(403);
  }
  const changed = f.request();
  changed.body += " ";
  expect((await f.send(changed)).status).toBe(403);
  expect(f.calls()).toBe(0);
});

test("missing public trust fails closed with a redacted configuration response", async () => {
  const f = fixture();
  delete process.env.INTERNAL_REQUEST_TRUST_FILE;
  const response = await f.send(f.request());
  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).toContain("misconfigured");
  expect(body).not.toContain(trustFile);
  expect(f.calls()).toBe(0);
});
