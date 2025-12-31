/**
 * SEC-INTERNAL-AUTH-2: Shared JWT test utilities
 *
 * This module provides shared test utilities for JWT-related tests,
 * eliminating code duplication across test files.
 */

import { createHmac } from "node:crypto";
import type {
  InternalJwtPayload,
  ServiceKey,
} from "../../src/infra/security/internal-jwt";

/** Test signing key for JWT generation */
export const TEST_SIGNING_KEY = "test-signing-key-32-bytes-minimum";

/** Legacy token for hybrid mode testing */
export const LEGACY_TOKEN = "unit-test-token";

/**
 * Base64url encode without padding (RFC 7515 compliant)
 */
export function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Base64url decode (RFC 7515 compliant)
 */
export function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

/**
 * Parse JWT payload without verification (for testing only)
 */
export function parseJwtUnsafe(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const json = base64UrlDecode(parts[1]).toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Create a test JWT with optional payload overrides.
 *
 * Supports two call signatures:
 * 1. createTestJwt({ aud: 'cms-service', ... }) - Full payload object
 * 2. createTestJwt('cms-service', signingKey, options) - Simplified signature
 */
export function createTestJwt(
  payloadOrAud:
    | (Partial<InternalJwtPayload> & { aud: ServiceKey })
    | ServiceKey,
  signingKey: string = TEST_SIGNING_KEY,
  options: {
    iat?: number;
    exp?: number;
    internal?: boolean;
    requestId?: string;
    iss?: ServiceKey;
  } = {},
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
): string {
  const now = Math.floor(Date.now() / 1000);

  let fullPayload: InternalJwtPayload;

  if (typeof payloadOrAud === "string") {
    // Simplified signature: createTestJwt('cms-service', key, options)
    fullPayload = {
      aud: payloadOrAud,
      iat: options.iat ?? now,
      exp: options.exp ?? now + 60,
      internal: (options.internal ?? true) as true,
      requestId: options.requestId ?? "req-test-123",
    };
    if (options.iss) {
      fullPayload.iss = options.iss;
    }
  } else {
    // Full payload signature: createTestJwt({ aud: 'cms-service', ... })
    fullPayload = {
      aud: payloadOrAud.aud,
      iat: payloadOrAud.iat ?? now,
      exp: payloadOrAud.exp ?? now + 60,
      internal: (payloadOrAud.internal ?? true) as true,
      requestId: payloadOrAud.requestId ?? "req-test-123",
    };
    if (payloadOrAud.iss) {
      fullPayload.iss = payloadOrAud.iss;
    }
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", signingKey)
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Create a custom JWT with full control over header and payload.
 * Useful for testing malformed tokens.
 */
export function createCustomJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signingKey: string = TEST_SIGNING_KEY
): string {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", signingKey)
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}
