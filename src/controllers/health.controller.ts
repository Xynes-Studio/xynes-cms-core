import type { Context } from "hono";
import { config } from "../infra/config";
import { checkPostgresReadiness } from "../infra/readiness";

const SERVICE_NAME = "xynes-cms-core";
const DEFAULT_VERSION = "dev";
const DB_PROBE_TIMEOUT_MS = 1000;
const PROBE_FAILURE_CACHE_TTL_MS = 30_000;

export type CheckStatus = "ok" | "fail" | "skipped";

export interface HealthResponseBody {
  ok: boolean;
  service: string;
  version: string;
  uptime_seconds: number;
  checks: {
    db: CheckStatus;
  };
}

export interface HealthControllerDeps {
  pingDb?: () => Promise<void>;
  getUptimeSeconds?: () => number;
  getVersion?: () => string;
  now?: () => number;
}

let dbProbeFailureAt: number | null = null;

export function resetHealthControllerCacheForTests(): void {
  dbProbeFailureAt = null;
}

function readDefaultVersion(): string {
  const raw = process.env.XYNES_BUILD_VERSION;
  if (!raw) return DEFAULT_VERSION;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_VERSION;
}

async function runWithTimeout(
  probe: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("db probe timeout")), timeoutMs);
  });

  try {
    await Promise.race([probe(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultPingDb(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || config.databaseUrl;
  await checkPostgresReadiness({ databaseUrl, schemaName: "cms" });
}

async function evaluateDbCheck(
  pingDb: () => Promise<void>,
  now: () => number,
): Promise<CheckStatus> {
  if (
    dbProbeFailureAt !== null &&
    now() - dbProbeFailureAt < PROBE_FAILURE_CACHE_TTL_MS
  ) {
    return "fail";
  }

  try {
    await runWithTimeout(pingDb, DB_PROBE_TIMEOUT_MS);
    dbProbeFailureAt = null;
    return "ok";
  } catch {
    dbProbeFailureAt = now();
    return "fail";
  }
}

export function createGetHealth(deps: HealthControllerDeps = {}) {
  const pingDb = deps.pingDb ?? defaultPingDb;
  const getUptimeSeconds =
    deps.getUptimeSeconds ?? (() => Math.floor(process.uptime()));
  const getVersion = deps.getVersion ?? readDefaultVersion;
  const now = deps.now ?? (() => Date.now());

  return async (c: Context) => {
    const dbStatus = await evaluateDbCheck(pingDb, now);
    const ok = dbStatus !== "fail";
    const body: HealthResponseBody = {
      ok,
      service: SERVICE_NAME,
      version: getVersion(),
      uptime_seconds: getUptimeSeconds(),
      checks: {
        db: dbStatus,
      },
    };

    return c.json(body, ok ? 200 : 503);
  };
}

export const getHealth = createGetHealth();
