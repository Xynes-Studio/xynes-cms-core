import { sql } from "drizzle-orm";
import { config } from "../infra/config";
import { db } from "../infra/db";
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
}

async function tryAcquireLock(): Promise<boolean> {
  const result = await db.execute(
    sql<{
      locked: boolean;
    }>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`,
  );
  return Boolean(result[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`);
}

export function createScheduledEntryPublisher(
  deps: Partial<ScheduledEntryPublisherDeps> = {},
): ScheduledEntryPublisher {
  const resolvedDeps: ScheduledEntryPublisherDeps = {
    tryAcquireLock,
    releaseLock,
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

    try {
      hasLock = await resolvedDeps.tryAcquireLock();
      if (!hasLock) {
        resolvedDeps.logger.info(
          "Scheduled entry publisher skipped; advisory lock not acquired",
        );
        return;
      }

      let publishedCount = 0;
      while (true) {
        const dueEntries = await resolvedDeps.listDueScheduledEntries(
          resolvedDeps.batchSize ?? DEFAULT_BATCH_SIZE,
        );
        if (dueEntries.length === 0) {
          break;
        }

        for (const entry of dueEntries) {
          const published =
            await resolvedDeps.publishScheduledEntryByIdAndWorkspace({
              entryId: entry.id,
              workspaceId: entry.workspaceId,
            });
          if (published) {
            publishedCount += 1;
          }
        }

        if (
          dueEntries.length < (resolvedDeps.batchSize ?? DEFAULT_BATCH_SIZE)
        ) {
          break;
        }
      }

      resolvedDeps.logger.info("Scheduled entry publisher run complete", {
        publishedCount,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolvedDeps.logger.error("Scheduled entry publisher run failed", {
        error: message,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      if (hasLock) {
        try {
          await resolvedDeps.releaseLock();
        } catch (unlockError) {
          const message =
            unlockError instanceof Error
              ? unlockError.message
              : String(unlockError);
          resolvedDeps.logger.error(
            "Scheduled entry publisher advisory unlock failed",
            { error: message },
          );
        }
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
