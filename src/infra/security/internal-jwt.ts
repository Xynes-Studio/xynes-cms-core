/**
 * SEC-INTERNAL-AUTH-2: Internal JWT Verification for Service-to-Service Authentication
 *
 * This module provides JWT verification for internal service authentication.
 * It supports both JWT-based auth (preferred) and legacy static token (transitional).
 *
 * Security considerations:
 * - Uses HS256 with timing-safe comparison
 * - Validates exp and iat claims to prevent replay attacks
 * - Validates audience claim to prevent token reuse across services
 * - Token values are NEVER logged (only metadata like exp, aud)
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Service keys for internal service identification.
 */
export type ServiceKey =
  | "doc-service"
  | "cms-service"
  | "authz-service"
  | "telemetry-service"
  | "accounts-service";

/**
 * Internal JWT payload structure.
 */
export interface InternalJwtPayload {
  /** Target service (audience) */
  aud: ServiceKey;
  /** Issued at timestamp (epoch seconds) */
  iat: number;
  /** Expiration timestamp (epoch seconds) */
  exp: number;
  /** Internal marker to distinguish from user JWTs */
  internal: true;
  /** Request correlation ID for tracing */
  requestId: string;
}

/**
 * Options for verifying an internal JWT.
 */
export interface VerifyInternalJwtOptions {
  /** Expected service key (audience) */
  expectedAudience: ServiceKey;
  /** Override current time for testing (epoch seconds) */
  nowEpochSeconds?: number;
  /** Max clock skew tolerance in seconds (default: 30) */
  clockSkewSeconds?: number;
  /** Max token age in seconds (default: 120) */
  maxAgeSeconds?: number;
}

/**
 * Result of JWT verification.
 */
export interface VerifyInternalJwtResult {
  /** Whether the token is valid */
  valid: boolean;
  /** The decoded payload if valid */
  payload?: InternalJwtPayload;
  /** Error reason if invalid (safe to log, no token values) */
  error?: string;
}

/**
 * Base64url decode without padding.
 */
function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

/**
 * Base64url encode without padding.
 */
function base64UrlEncode(data: Buffer): string {
  return data
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Safely parse JSON from base64url encoded string.
 */
function parseBase64UrlJson<T>(input: string): T | null {
  try {
    const json = base64UrlDecode(input).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Timing-safe signature comparison using HMAC.
 */
function verifySignature(
  signingInput: string,
  signature: string,
  signingKey: string
): boolean {
  try {
    const expected = createHmac("sha256", signingKey)
      .update(signingInput)
      .digest();
    const expectedEncoded = base64UrlEncode(expected);

    const expectedBuf = Buffer.from(expectedEncoded);
    const providedBuf = Buffer.from(signature);

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * Check if a string looks like a JWT (has three base64url parts).
 */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  // Check if first part decodes to a valid header with alg
  const firstPart = parts[0];
  if (!firstPart) return false;
  const header = parseBase64UrlJson<{ alg?: string; typ?: string }>(firstPart);
  return header !== null && typeof header.alg === "string";
}

/**
 * Verify an internal JWT for service-to-service communication.
 *
 * @param token - The JWT string from X-Internal-Service-Token header
 * @param signingKey - The INTERNAL_JWT_SIGNING_KEY secret
 * @param options - Verification options including expected audience
 * @returns Verification result with payload if valid, error message if invalid
 */
export function verifyInternalJwt(
  token: string,
  signingKey: string,
  options: VerifyInternalJwtOptions
): VerifyInternalJwtResult {
  const {
    expectedAudience,
    clockSkewSeconds = 30,
    maxAgeSeconds = 120,
  } = options;
  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000);

  // Split token into parts
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "invalid_format" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { valid: false, error: "missing_parts" };
  }

  // Parse and validate header
  const header = parseBase64UrlJson<{ alg?: string; typ?: string }>(
    encodedHeader
  );
  if (!header) {
    return { valid: false, error: "invalid_header" };
  }
  if (header.alg !== "HS256") {
    return { valid: false, error: "unsupported_algorithm" };
  }

  // Verify signature before parsing payload (prevent timing attacks)
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  if (!verifySignature(signingInput, encodedSignature, signingKey)) {
    return { valid: false, error: "invalid_signature" };
  }

  // Parse payload
  const payload = parseBase64UrlJson<InternalJwtPayload>(encodedPayload);
  if (!payload) {
    return { valid: false, error: "invalid_payload" };
  }

  // Validate internal marker
  if (payload.internal !== true) {
    return { valid: false, error: "not_internal_token" };
  }

  // Validate audience
  if (payload.aud !== expectedAudience) {
    return { valid: false, error: "audience_mismatch" };
  }

  // Validate iat (issued at) - must be present and not too old
  if (typeof payload.iat !== "number") {
    return { valid: false, error: "missing_iat" };
  }
  if (payload.iat > now + clockSkewSeconds) {
    return { valid: false, error: "iat_future" };
  }
  if (payload.iat < now - maxAgeSeconds) {
    return { valid: false, error: "iat_too_old" };
  }

  // Validate exp (expiration)
  if (typeof payload.exp !== "number") {
    return { valid: false, error: "missing_exp" };
  }
  if (now >= payload.exp + clockSkewSeconds) {
    return { valid: false, error: "token_expired" };
  }

  // Validate requestId is present (for correlation)
  if (typeof payload.requestId !== "string" || payload.requestId.length === 0) {
    return { valid: false, error: "missing_request_id" };
  }

  return { valid: true, payload };
}
