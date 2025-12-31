/**
 * SEC-INTERNAL-AUTH-2: Tests for Internal Service Authentication Middleware
 *
 * Coverage targets:
 * - JWT-based authentication
 * - Legacy token authentication (hybrid mode)
 * - Missing token handling
 * - Invalid token handling
 * - Configuration validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { requireInternalServiceAuth } from "../../../src/middleware/internal-service-auth";

const LEGACY_TOKEN = "unit-test-token";
const JWT_SIGNING_KEY = "test-jwt-signing-key-32-bytes-minimum";

/**
 * Helper to base64url encode without padding
 */
function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buffer.toString("base64url").replace(/=+$/, "");
}

/**
 * Helper to create a valid internal JWT for testing
 */
function createTestJwt(
  audience: string = "cms-service",
  signingKey: string = JWT_SIGNING_KEY,
  options: {
    iat?: number;
    exp?: number;
    internal?: boolean;
    requestId?: string;
  } = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    aud: audience,
    iat: options.iat ?? now,
    exp: options.exp ?? now + 60,
    internal: options.internal ?? true,
    requestId: options.requestId ?? "req-test-123",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", signingKey)
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

describe("requireInternalServiceAuth (unit)", () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = LEGACY_TOKEN;
    delete process.env.INTERNAL_JWT_SIGNING_KEY;
    delete process.env.INTERNAL_AUTH_MODE;
  });

  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_JWT_SIGNING_KEY;
    delete process.env.INTERNAL_AUTH_MODE;
  });

  describe("configuration validation", () => {
    it("returns 500 when neither JWT key nor legacy token is configured", async () => {
      delete process.env.INTERNAL_SERVICE_TOKEN;
      delete process.env.INTERNAL_JWT_SIGNING_KEY;

      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
    });
  });

  describe("missing token", () => {
    it("returns 401 when header is missing and does not call handler", async () => {
      const app = new Hono();
      const handler = vi.fn((c) => c.json({ ok: true }));
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", handler);

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("JWT-based authentication", () => {
    beforeEach(() => {
      process.env.INTERNAL_JWT_SIGNING_KEY = JWT_SIGNING_KEY;
      process.env.INTERNAL_AUTH_MODE = "jwt";
    });

    it("accepts valid JWT with correct audience", async () => {
      const app = new Hono();
      let ran = false;
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => {
        ran = true;
        return c.json({ ok: true });
      });

      const jwt = createTestJwt("cms-service");
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(ran).toBe(true);
    });

    it("rejects JWT with wrong audience", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const jwt = createTestJwt("doc-service"); // Wrong audience
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
    });

    it("rejects JWT with wrong signing key", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const jwt = createTestJwt("cms-service", "wrong-signing-key");
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
    });

    it("rejects expired JWT", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const pastTime = Math.floor(Date.now() / 1000) - 120;
      const jwt = createTestJwt("cms-service", JWT_SIGNING_KEY, {
        iat: pastTime - 60,
        exp: pastTime,
      });
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("legacy token authentication (hybrid mode)", () => {
    beforeEach(() => {
      process.env.INTERNAL_SERVICE_TOKEN = LEGACY_TOKEN;
      process.env.INTERNAL_AUTH_MODE = "hybrid";
    });

    it("accepts valid legacy token", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": LEGACY_TOKEN,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
    });

    it("rejects invalid legacy token", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": "wrong-token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("hybrid mode with both JWT and legacy token", () => {
    beforeEach(() => {
      process.env.INTERNAL_JWT_SIGNING_KEY = JWT_SIGNING_KEY;
      process.env.INTERNAL_SERVICE_TOKEN = LEGACY_TOKEN;
      process.env.INTERNAL_AUTH_MODE = "hybrid";
    });

    it("accepts valid JWT when both are configured", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const jwt = createTestJwt("cms-service");
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
    });

    it("accepts legacy token when JWT fails in hybrid mode", async () => {
      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      // Send legacy token (not JWT)
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": LEGACY_TOKEN,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
    });

    it("rejects invalid JWT in jwt-only mode even with legacy token configured", async () => {
      process.env.INTERNAL_AUTH_MODE = "jwt";

      const app = new Hono();
      app.use("*", requireInternalServiceAuth());
      app.post("/internal/cms-actions", (c) => c.json({ ok: true }));

      const jwt = createTestJwt("doc-service"); // Wrong audience
      const res = await app.request("/internal/cms-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": jwt,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
    });
  });
});
