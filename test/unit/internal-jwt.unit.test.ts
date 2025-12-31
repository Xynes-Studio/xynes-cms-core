/**
 * SEC-INTERNAL-AUTH-2: Tests for Internal JWT Verification
 *
 * Coverage targets:
 * - JWT structure validation
 * - Signature verification
 * - Audience validation
 * - Issuer validation
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
import {
  createTestJwt,
  createCustomJwt,
  TEST_SIGNING_KEY,
  base64UrlEncode,
} from "../helpers/jwt-test-utils";

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

  describe("issuer validation", () => {
    it("accepts token with matching issuer when expectedIssuer is set", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iss: "gateway-service",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        expectedIssuer: "gateway-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.iss).toBe("gateway-service");
    });

    it("rejects token with wrong issuer", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iss: "doc-service",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        expectedIssuer: "gateway-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("issuer_mismatch");
    });

    it("accepts token without issuer when expectedIssuer is not set", () => {
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
    });

    it("accepts token with issuer when expectedIssuer is not set", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iss: "gateway-service",
        iat: now,
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.iss).toBe("gateway-service");
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

    it("rejects token with iat too old", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now - 200, // Too old (maxAgeSeconds default is 120)
        exp: now + 60,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("iat_too_old");
    });

    it("accepts token within clock skew tolerance", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now + 20, // Within 30s clock skew
        exp: now + 80,
      });

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
        clockSkewSeconds: 30,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("format validation", () => {
    it("rejects token with wrong number of parts", () => {
      const result = verifyInternalJwt("only.two", TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid_format");
    });

    it("rejects token with empty parts", () => {
      const result = verifyInternalJwt("a..c", TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing_parts");
    });

    it("rejects token with invalid header", () => {
      const result = verifyInternalJwt("notbase64.payload.sig", TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid_header");
    });

    it("rejects token with unsupported algorithm", () => {
      const token = createCustomJwt(
        { alg: "RS256", typ: "JWT" },
        {
          aud: "cms-service",
          iat: now,
          exp: now + 60,
          internal: true,
          requestId: "req-123",
        }
      );

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("unsupported_algorithm");
    });
  });

  describe("internal marker validation", () => {
    it("rejects token without internal marker", () => {
      const header = { alg: "HS256", typ: "JWT" };
      const payload = {
        aud: "cms-service",
        iat: now,
        exp: now + 60,
        requestId: "req-123",
        // Missing internal: true
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signature = createHmac("sha256", TEST_SIGNING_KEY)
        .update(signingInput)
        .digest();
      const token = `${signingInput}.${base64UrlEncode(signature)}`;

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("not_internal_token");
    });
  });

  describe("requestId validation", () => {
    it("rejects token without requestId", () => {
      const header = { alg: "HS256", typ: "JWT" };
      const payload = {
        aud: "cms-service",
        iat: now,
        exp: now + 60,
        internal: true,
        // Missing requestId
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signature = createHmac("sha256", TEST_SIGNING_KEY)
        .update(signingInput)
        .digest();
      const token = `${signingInput}.${base64UrlEncode(signature)}`;

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing_request_id");
    });

    it("rejects token with empty requestId", () => {
      const header = { alg: "HS256", typ: "JWT" };
      const payload = {
        aud: "cms-service",
        iat: now,
        exp: now + 60,
        internal: true,
        requestId: "",
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signature = createHmac("sha256", TEST_SIGNING_KEY)
        .update(signingInput)
        .digest();
      const token = `${signingInput}.${base64UrlEncode(signature)}`;

      const result = verifyInternalJwt(token, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing_request_id");
    });
  });

  describe("signature validation", () => {
    it("rejects tampered payload", () => {
      const token = createTestJwt({
        aud: "cms-service",
        iat: now,
        exp: now + 60,
      });

      // Tamper with the payload
      const parts = token.split(".");
      const tamperedPayload = base64UrlEncode(
        JSON.stringify({
          aud: "cms-service",
          iat: now,
          exp: now + 3600, // Changed expiration
          internal: true,
          requestId: "req-test-123",
        })
      );
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = verifyInternalJwt(tamperedToken, TEST_SIGNING_KEY, {
        expectedAudience: "cms-service",
        nowEpochSeconds: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid_signature");
    });
  });
});
