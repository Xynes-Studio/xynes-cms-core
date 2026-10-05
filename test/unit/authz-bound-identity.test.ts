import { afterAll, afterEach, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthzClient } from "../../src/infra/authz/authz-client";
import { verifyInternalRequest } from "../../src/infra/security/internal-request";

const keys = generateKeyPairSync("ed25519");
const directory = mkdtempSync(join(tmpdir(), "authz-bound-fixture-"));
const file = join(directory, "private.pem");
writeFileSync(file, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
  mode: 0o600,
});
const savedFetch = globalThis.fetch;
const savedFile = process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE;
const savedKeyId = process.env.INTERNAL_REQUEST_KEY_ID;
afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedFile === undefined)
    delete process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE;
  else process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE = savedFile;
  if (savedKeyId === undefined) delete process.env.INTERNAL_REQUEST_KEY_ID;
  else process.env.INTERNAL_REQUEST_KEY_ID = savedKeyId;
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("authz client signs the exact permission request and actor/workspace context", async () => {
  process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE = file;
  process.env.INTERNAL_REQUEST_KEY_ID = "fixture-key";
  let calls = 0;
  const fixtureFetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const req = {
        audience: "authz-service",
        operation: "authz.check",
        url: String(input),
        method: "POST",
        headers,
        body,
      };
      const trust = [
        { issuer: "cms", keyId: "fixture-key", publicKey: keys.publicKey },
      ];
      const token = headers.get("X-Internal-Service-Token") ?? "";
      expect(verifyInternalRequest(token, req, trust)).toBe(true);
      expect(headers.get("X-XS-User-Id")).toBe("actor-a");
      expect(headers.get("X-Workspace-Id")).toBe("tenant-a");
      expect(headers.get("X-Request-Id")).toBeTruthy();
      expect(
        verifyInternalRequest(
          token,
          { ...req, body: body.replace("tenant-a", "tenant-b") },
          trust,
        ),
      ).toBe(false);
      return Response.json({ ok: true, data: { allowed: true } });
    },
    { preconnect: savedFetch.preconnect },
  );
  globalThis.fetch = fixtureFetch;
  const client = new AuthzClient(
    "http://fixture-authz",
    "obsolete-shared-fixture",
  );
  expect(
    await client.check({
      userId: "actor-a",
      workspaceId: "tenant-a",
      actionKey: "cms.entry.create",
    }),
  ).toEqual({ allowed: true });
  expect(calls).toBe(1);
});

test("missing private identity fails before any network call; no shared-token fallback", async () => {
  delete process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE;
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return Response.json({ allowed: true });
    },
    { preconnect: savedFetch.preconnect },
  );
  const client = new AuthzClient(
    "http://fixture-authz",
    "obsolete-shared-fixture",
  );
  await expect(
    client.check({
      userId: "actor-a",
      workspaceId: "tenant-a",
      actionKey: "cms.entry.create",
    }),
  ).rejects.toThrow("misconfigured");
  expect(calls).toBe(0);
});
