import postgres from "postgres";
import { config } from "../infra/config";
import {
  listDueScheduledEntries,
  publishScheduledEntryByIdAndWorkspace,
} from "../infra/db/repositories/content-entry.repository";
import { logger as defaultLogger } from "../infra/logger";

const LOCK_KEY = 9_143_202;
const DEFAULT_BATCH_SIZE = 50;

export interface ScheduledEntryPublisher {
  runNow: () => Promise<void>;
  stop: () => void;
}

interface ScheduledEntryPublisherDeps {
  tryAcquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  listDueScheduledEntries: typeof listDueScheduledEntries;
  publishScheduledEntryByIdAndWorkspace: typeof publishScheduledEntryByIdAndWorkspace;
  logger: Pick<typeof defaultLogger, "info" | "warn" | "error">;
  batchSize?: number;
  maxBatches?: number;
}

function createLockSession() {
  // Session advisory locks must be acquired/released on one owned connection.
  const client = postgres(config.databaseUrl, { max: 1, connect_timeout: 5 });
  return {
    tryAcquireLock: async () => {
      const rows = await client<
        { locked: boolean }[]
      >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
      return rows[0]?.locked === true;
    },
    releaseLock: async () => {
      await client`select pg_advisory_unlock(${LOCK_KEY})`;
    },
    close: async () => {
      await client.end({ timeout: 1 });
    },
  };
}

export function createScheduledEntryPublisher(
  deps: Partial<ScheduledEntryPublisherDeps> = {},
): ScheduledEntryPublisher {
  const resolvedDeps = {
    listDueScheduledEntries,
    publishScheduledEntryByIdAndWorkspace,
    logger: defaultLogger,
    batchSize: DEFAULT_BATCH_SIZE,
    ...deps,
  };

  let running = false;

  const runNow = async () => {
    if (running) {
      return;
    }

    running = true;
    const startedAt = Date.now();
    let hasLock = false;
    const lockSession = createLockSession();

    try {
      hasLock = await (
        resolvedDeps.tryAcquireLock ?? lockSession.tryAcquireLock
      )();
      if (!hasLock) {
        resolvedDeps.logger.info(
          "Scheduled entry publisher skipped; advisory lock not acquired",
        );
        return;
      }

      let publishedCount = 0;
      const visited = new Set<string>();
      const batchSize = Math.max(
        1,
        Math.min(200, Math.trunc(resolvedDeps.batchSize ?? DEFAULT_BATCH_SIZE)),
      );
      const maxBatches = Math.max(
        1,
        Math.min(20, Math.trunc(resolvedDeps.maxBatches ?? 20)),
      );
      for (let batch = 0; batch < maxBatches; batch++) {
        const dueEntries = await resolvedDeps.listDueScheduledEntries(
          batchSize,
          [...visited],
        );
        if (dueEntries.length === 0) {
          break;
        }

        const freshEntries = dueEntries.filter(
          (entry) => !visited.has(entry.id),
        );
        if (!freshEntries.length) break;
        for (const entry of freshEntries) {
          visited.add(entry.id);
          try {
            const published =
              await resolvedDeps.publishScheduledEntryByIdAndWorkspace({
                entryId: entry.id,
                workspaceId: entry.workspaceId,
              });
            if (published) {
              publishedCount += 1;
            }
          } catch {
            resolvedDeps.logger.warn("Scheduled entry publication failed", {
              entryId: entry.id,
              code: "SCHEDULED_PUBLICATION_FAILED",
            });
          }
        }

        if (dueEntries.length < batchSize) {
          break;
        }
      }

      resolvedDeps.logger.info("Scheduled entry publisher run complete", {
        publishedCount,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      resolvedDeps.logger.error("Scheduled entry publisher run failed", {
        error: "SCHEDULER_FAILURE",
        durationMs: Date.now() - startedAt,
      });
    } finally {
      if (hasLock) {
        try {
          await (resolvedDeps.releaseLock ?? lockSession.releaseLock)();
        } catch {
          resolvedDeps.logger.error(
            "Scheduled entry publisher advisory unlock failed",
            { error: "SCHEDULER_UNLOCK_FAILURE" },
          );
        }
      }
      try {
        await lockSession.close();
      } catch {
        resolvedDeps.logger.error(
          "Scheduled publisher lock session close failed",
          { error: "SCHEDULER_LOCK_CLOSE_FAILURE" },
        );
      }
      running = false;
    }
  };

  return {
    runNow,
    stop: () => undefined,
  };
}

interface StartScheduledEntryPublisherDeps {
  scheduler?: ScheduledEntryPublisher;
  pollIntervalMs?: number;
  logger?: Pick<typeof defaultLogger, "info">;
}

export function startScheduledEntryPublisher(
  deps: StartScheduledEntryPublisherDeps = {},
): ScheduledEntryPublisher {
  const scheduler = deps.scheduler ?? createScheduledEntryPublisher();
  const pollIntervalMs = deps.pollIntervalMs ?? config.schedulePollIntervalMs;
  const logger = deps.logger ?? defaultLogger;

  logger.info("Scheduled entry publisher starting", {
    pollIntervalMs,
  });

  const timer = setInterval(() => {
    void scheduler.runNow();
  }, pollIntervalMs);

  void scheduler.runNow();

  return {
    runNow: scheduler.runNow,
    stop: () => {
      clearInterval(timer);
      scheduler.stop();
    },
  };
}
