/**
 * Authz Service Client
 *
 * CMS-RBAC-1: Client for calling the authz service to check permissions.
 * All CMS actions must be permission-checked via this client.
 */

import { logger } from "../logger";

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
  return value.slice(0, 8) + "...";
}

export class AuthzClient implements IAuthzClient {
  private authzUrl: string;
  private internalServiceToken: string;
  private timeoutMs: number;

  constructor(
    authzUrl: string,
    internalServiceToken: string,
    timeoutMs?: number,
  ) {
    this.authzUrl = authzUrl;
    this.internalServiceToken = internalServiceToken;
    this.timeoutMs = timeoutMs ?? DEFAULT_AUTHZ_TIMEOUT_MS;
  }

  private static extractAllowed(value: unknown): boolean | null {
    if (!value || typeof value !== "object") return null;

    // Handle { allowed: boolean } response
    if (
      "allowed" in value &&
      typeof (value as { allowed?: unknown }).allowed === "boolean"
    ) {
      return (value as { allowed: boolean }).allowed;
    }

    // Handle { ok: true, data: { allowed: boolean } } envelope
    if (
      "ok" in value &&
      (value as { ok?: unknown }).ok === true &&
      "data" in value
    ) {
      const data = (value as { data?: unknown }).data;
      if (
        data &&
        typeof data === "object" &&
        "allowed" in data &&
        typeof (data as { allowed?: unknown }).allowed === "boolean"
      ) {
        return (data as { allowed: boolean }).allowed;
      }
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
      const response = await fetch(`${this.authzUrl}/authz/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Token": this.internalServiceToken,
        },
        body: JSON.stringify({ userId, workspaceId, actionKey }),
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
        logger.error(
          "[AuthzClient] Could not extract allowed from response",
          {
            actionKey,
            anonUserId,
            anonWorkspaceId,
          },
        );
        throw new Error("Invalid response format from authz service");
      }

      return { allowed };
    } catch (error) {
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
        error: (error as Error).message,
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
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || "";

  if (!internalServiceToken) {
    logger.warn(
      "[AuthzClient] INTERNAL_SERVICE_TOKEN not set - authz calls will fail",
    );
  }

  return new AuthzClient(authzUrl, internalServiceToken);
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
