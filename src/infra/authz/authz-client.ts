/**
 * Authz Service Client
 *
 * CMS-RBAC-1: Client for calling the authz service to check permissions.
 * All CMS actions must be permission-checked via this client.
 */

import { logger } from "../logger";
import {
  loadInternalRequestSigner,
  signInternalRequest,
} from "../security/internal-request";

export interface AuthzCheckParams {
  userId: string;
  workspaceId: string;
  actionKey: string;
}

export interface AuthzCheckResult {
  allowed: boolean;
}

export interface IAuthzClient {
  check(params: AuthzCheckParams): Promise<AuthzCheckResult>;
}

/** Default timeout for authz service requests in milliseconds */
const DEFAULT_AUTHZ_TIMEOUT_MS = 5000;

/**
 * Creates an anonymized identifier for logging purposes.
 * Uses first 8 characters to allow correlation without exposing full PII.
 */
function anonymize(value: string | undefined): string {
  if (!value) return "none";
  return `${value.slice(0, 8)}...`;
}

export class AuthzClient implements IAuthzClient {
  private authzUrl: string;
  private timeoutMs: number;

  constructor(authzUrl: string, _legacyToken: string, timeoutMs?: number) {
    this.authzUrl = authzUrl;
    this.timeoutMs = timeoutMs ?? DEFAULT_AUTHZ_TIMEOUT_MS;
  }

  private static extractAllowed(value: unknown): boolean | null {
    if (!value || typeof value !== "object") return null;
    if ("allowed" in value && typeof value.allowed === "boolean")
      return value.allowed;
    if ("ok" in value && value.ok === true && "data" in value) {
      const data = value.data;
      if (
        data &&
        typeof data === "object" &&
        "allowed" in data &&
        typeof data.allowed === "boolean"
      )
        return data.allowed;
    }
    return null;
  }

  async check(params: AuthzCheckParams): Promise<AuthzCheckResult> {
    const { userId, workspaceId, actionKey } = params;
    const anonUserId = anonymize(userId);
    const anonWorkspaceId = anonymize(workspaceId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.authzUrl}/authz/check`;
      const body = JSON.stringify({ userId, workspaceId, actionKey });
      const headers = new Headers({
        "Content-Type": "application/json",
        "X-XS-User-Id": userId,
        "X-Workspace-Id": workspaceId,
      });
      headers.set(
        "X-Internal-Service-Token",
        signInternalRequest(
          {
            audience: "authz-service",
            operation: "authz.check",
            url,
            method: "POST",
            headers,
            body,
          },
          loadInternalRequestSigner("cms"),
        ),
      );
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.error("[AuthzClient] Authz service returned non-OK status", {
          status: response.status,
          actionKey,
          anonUserId,
          anonWorkspaceId,
        });
        throw new Error(
          `Authz service returned non-OK status: ${response.status}`,
        );
      }

      const parsed = await response.json().catch(() => null);
      const allowed = AuthzClient.extractAllowed(parsed);

      if (allowed === null) {
        logger.error("[AuthzClient] Could not extract allowed from response", {
          actionKey,
          anonUserId,
          anonWorkspaceId,
        });
        throw new Error("Invalid response format from authz service");
      }

      return { allowed };
    } catch (error: unknown) {
      // Handle abort/timeout specifically
      if (error instanceof Error && error.name === "AbortError") {
        logger.error("[AuthzClient] Authz check timed out", {
          actionKey,
          anonUserId,
          anonWorkspaceId,
          timeoutMs: this.timeoutMs,
        });
        throw new Error(
          `Authz service request timed out after ${this.timeoutMs}ms`,
        );
      }

      logger.error("[AuthzClient] Authz check failed", {
        error: "Internal permission request failed",
        actionKey,
        anonUserId,
        anonWorkspaceId,
      });
      // Re-throw to let caller handle - fail-closed at route level
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Creates an AuthzClient instance from environment variables.
 */
export function createAuthzClient(): IAuthzClient {
  const authzUrl = process.env.AUTHZ_SERVICE_URL || "http://localhost:4300";
  return new AuthzClient(authzUrl, "");
}

// Default singleton instance
let defaultClient: IAuthzClient | null = null;

export function getAuthzClient(): IAuthzClient {
  if (!defaultClient) {
    defaultClient = createAuthzClient();
  }
  return defaultClient;
}

// For testing - allows injecting a mock
export function setAuthzClient(client: IAuthzClient): void {
  defaultClient = client;
}

export function resetAuthzClient(): void {
  defaultClient = null;
}
