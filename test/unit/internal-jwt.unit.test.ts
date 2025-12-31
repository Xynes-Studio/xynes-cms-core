/**
 * SEC-INTERNAL-AUTH-2: Tests for Internal JWT Verification
 *
 * Coverage targets:
 * - JWT structure validation
 * - Signature verification
 * - Audience validation
 * - Time-based validations (exp, iat)
 * - Error handling
 */

import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import {
  verifyInternalJwt,
  looksLikeJwt,
  type InternalJwtPayload,
  type ServiceKey,
} from "../../src/infra/security/internal-jwt";

const TEST_SIGNING_KEY = "test-signing-key-32-bytes-minimum";

/**
 * Helper to base64url encode without padding
 */
function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Helper to create a valid JWT for testing
 */
function createTestJwt(
  payload: Partial<InternalJwtPayload> & { aud: ServiceKey },
  signingKey: string = TEST_SIGNING_KEY,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: InternalJwtPayload = {
    aud: payload.aud,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + 60,
    internal: payload.internal ?? true,
    requestId: payload.requestId ?? "req-test-123",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", signingKey)
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

describe("looksLikeJwt", () => {
  it("returns true for valid JWT format", () => {
    const token = createTestJwt({ aud: "cms-service" });
    expect(looksLikeJwt(token)).toBe(true);
  });

  it("returns false for non-JWT strings", () => {
    expect(looksLikeJwt("not-a-jwt")).toBe(false);
    expect(looksLikeJwt("two.parts")).toBe(false);
    expect(looksLikeJwt("")).toBe(false);
  });

  it("returns false for static token that looks like legacy format", () => {
    expect(looksLikeJwt("change-me-to-a-long-random-secret")).toBe(false);
  });
});

describe("verifyInternalJwt", () => {
  const now = 1700000000;

  describe("valid tokens", () => {
    it("accepts valid JWT with correct audience", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.aud).toBe("cms-service");
      expect(result.payload?.internal).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns payload with requestId", () => {
      const token = createTestJwt({
        aud: "cms-service",
        requestId: "req-correlation-123",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.requestId).toBe("req-correlation-123");
    });
  });

  describe("signature validation", () => {
    it("rejects token with wrong signing key", () => {
      const token = createTestJwt({ aud: "cms-service" }, "correct-key");

      const result = verifyInternalJwt(token, "wrong-key", {
        expectedAudience: "cms-service",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid_signature");
    });
  });

  describe("audience validation", () => {
    it("rejects token with wrong audience", () => {
      const token = createTestJwt({
        aud: "doc-service",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("audience_mismatch");
    });
  });

  describe("time validation", () => {
    it("rejects expired token", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now - 120,
        exp: now - 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("token_expired");
    });

    it("rejects token with iat too far in future", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now + 120,
        exp: now + 180,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
        clockSkewSeconds: 30,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("iat_future");
    });
  });
});
