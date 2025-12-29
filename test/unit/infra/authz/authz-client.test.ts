/**
 * Unit Tests for AuthzClient
 *
 * CMS-RBAC-1: Tests for the authz service client.
 * These tests mock fetch to avoid network calls.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import {
  AuthzClient,
  createAuthzClient,
  getAuthzClient,
  setAuthzClient,
  resetAuthzClient,
  type IAuthzClient,
} from "../../../../src/infra/authz/authz-client";

describe("AuthzClient (Unit)", () => {
  const TEST_AUTHZ_URL = "http://authz-service:4300";
  const TEST_TOKEN = "test-internal-token";
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    resetAuthzClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetAuthzClient();
  });

  describe("check()", () => {
    it("should return allowed=true when authz service returns allowed in envelope", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: { allowed: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);
      const result = await client.check({
        userId: "user-123",
        workspaceId: "ws-456",
        actionKey: "cms.content.create",
      });

      expect(result.allowed).toBe(true);
    });

    it("should return allowed=true when authz service returns flat allowed", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ allowed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);
      const result = await client.check({
        userId: "user-123",
        workspaceId: "ws-456",
        actionKey: "cms.content.listPublished",
      });

      expect(result.allowed).toBe(true);
    });

    it("should return allowed=false when authz service denies", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: { allowed: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);
      const result = await client.check({
        userId: "user-123",
        workspaceId: "ws-456",
        actionKey: "cms.content.create",
      });

      expect(result.allowed).toBe(false);
    });

    it("should throw when authz service returns non-OK status", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR" } }),
            {
              status: 500,
            },
          ),
        ),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);

      await expect(
        client.check({
          userId: "user-123",
          workspaceId: "ws-456",
          actionKey: "cms.content.create",
        }),
      ).rejects.toThrow("Authz service returned non-OK status: 500");
    });

    it("should throw when authz service returns invalid response format", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ unexpected: "format" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);

      await expect(
        client.check({
          userId: "user-123",
          workspaceId: "ws-456",
          actionKey: "cms.content.create",
        }),
      ).rejects.toThrow("Invalid response format from authz service");
    });

    it("should throw on network error", async () => {
      global.fetch = mock(() =>
        Promise.reject(new Error("Network error")),
      ) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);

      await expect(
        client.check({
          userId: "user-123",
          workspaceId: "ws-456",
          actionKey: "cms.content.create",
        }),
      ).rejects.toThrow("Network error");
    });

    it("should throw on timeout", async () => {
      // Create a fetch that takes longer than the timeout
      // Using AbortController signal to properly simulate timeout
      let wasAborted = false;
      global.fetch = mock((url: string | URL | Request, options?: RequestInit) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              wasAborted = true;
              const abortError = new Error("The operation was aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }
          // Never resolve - wait for abort
        });
      }) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN, 50); // 50ms timeout

      await expect(
        client.check({
          userId: "user-123",
          workspaceId: "ws-456",
          actionKey: "cms.content.create",
        }),
      ).rejects.toThrow("Authz service request timed out after 50ms");

      expect(wasAborted).toBe(true);
    });

    it("should send correct headers and body", async () => {
      let capturedRequest: { url: string; options: RequestInit } | null = null;

      global.fetch = mock((url: string | URL | Request, options?: RequestInit) => {
        capturedRequest = { url: url.toString(), options: options || {} };
        return Promise.resolve(
          new Response(JSON.stringify({ allowed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const client = new AuthzClient(TEST_AUTHZ_URL, TEST_TOKEN);
      await client.check({
        userId: "user-123",
        workspaceId: "ws-456",
        actionKey: "cms.content.create",
      });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.url).toBe(`${TEST_AUTHZ_URL}/authz/check`);
      expect(capturedRequest!.options.method).toBe("POST");
      expect(capturedRequest!.options.headers).toEqual({
        "Content-Type": "application/json",
        "X-Internal-Service-Token": TEST_TOKEN,
      });
      expect(JSON.parse(capturedRequest!.options.body as string)).toEqual({
        userId: "user-123",
        workspaceId: "ws-456",
        actionKey: "cms.content.create",
      });
    });
  });

  describe("Singleton management", () => {
    it("should return same instance on repeated getAuthzClient calls", () => {
      const mockClient: IAuthzClient = {
        check: mock(() => Promise.resolve({ allowed: true })),
      };
      setAuthzClient(mockClient);

      const client1 = getAuthzClient();
      const client2 = getAuthzClient();

      expect(client1).toBe(client2);
      expect(client1).toBe(mockClient);
    });

    it("should reset client on resetAuthzClient", () => {
      const mockClient: IAuthzClient = {
        check: mock(() => Promise.resolve({ allowed: true })),
      };
      setAuthzClient(mockClient);

      expect(getAuthzClient()).toBe(mockClient);

      resetAuthzClient();

      // After reset, getAuthzClient should create a new instance
      // We can't easily test this without env vars, so just verify reset works
      const newClient = getAuthzClient();
      expect(newClient).not.toBe(mockClient);
    });

    it("should allow injecting mock client", () => {
      const mockClient: IAuthzClient = {
        check: mock(() => Promise.resolve({ allowed: false })),
      };
      setAuthzClient(mockClient);

      const client = getAuthzClient();
      expect(client).toBe(mockClient);
    });
  });

  describe("createAuthzClient", () => {
    it("should create client with default URL when env not set", () => {
      const originalUrl = process.env.AUTHZ_SERVICE_URL;
      const originalToken = process.env.INTERNAL_SERVICE_TOKEN;

      delete process.env.AUTHZ_SERVICE_URL;
      process.env.INTERNAL_SERVICE_TOKEN = "test-token";

      const client = createAuthzClient();
      expect(client).toBeDefined();

      // Restore to exact prior state
      if (originalUrl !== undefined) {
        process.env.AUTHZ_SERVICE_URL = originalUrl;
      } else {
        delete process.env.AUTHZ_SERVICE_URL;
      }
      if (originalToken !== undefined) {
        process.env.INTERNAL_SERVICE_TOKEN = originalToken;
      } else {
        delete process.env.INTERNAL_SERVICE_TOKEN;
      }
    });
  });
});
