import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createScheduledEntryPublisher,
  startScheduledEntryPublisher,
} from "../../src/scheduling/scheduled-entry-publisher";

const logger = {
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
};

function dueEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    publishedAt: new Date("2026-02-26T11:59:00.000Z"),
    ...overrides,
  };
}

describe("scheduled-entry-publisher", () => {
  beforeEach(() => {
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  it("publishes due scheduled entries in batches", async () => {
    const first = dueEntry();
    const second = dueEntry();
    const third = dueEntry();
    const listDueScheduledEntries = mock(() =>
      Promise.resolve([first, second]),
    )
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([third])
      .mockResolvedValueOnce([]);
    const publishScheduledEntryByIdAndWorkspace = mock(() =>
      Promise.resolve(first),
    );

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => Promise.resolve(true),
      releaseLock: () => Promise.resolve(),
      listDueScheduledEntries,
      publishScheduledEntryByIdAndWorkspace,
      logger,
      batchSize: 2,
    });

    await scheduler.runNow();

    expect(listDueScheduledEntries).toHaveBeenCalledTimes(2);
    expect(publishScheduledEntryByIdAndWorkspace).toHaveBeenCalledTimes(3);
    expect(publishScheduledEntryByIdAndWorkspace).toHaveBeenNthCalledWith(1, {
      entryId: first.id,
      workspaceId: first.workspaceId,
    });
    expect(publishScheduledEntryByIdAndWorkspace).toHaveBeenNthCalledWith(3, {
      entryId: third.id,
      workspaceId: third.workspaceId,
    });
  });

  it("does not overlap runs when a previous pass is still active", async () => {
    let releaseLock: () => void = () => undefined;
    const lockGate = new Promise<boolean>((resolve) => {
      releaseLock = () => resolve(true);
    });
    const listDueScheduledEntries = mock(() => Promise.resolve([]));

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => lockGate,
      releaseLock: () => Promise.resolve(),
      listDueScheduledEntries,
      publishScheduledEntryByIdAndWorkspace: mock(() => Promise.resolve(null)),
      logger,
      batchSize: 50,
    });

    const firstRun = scheduler.runNow();
    await scheduler.runNow();
    releaseLock();
    await firstRun;

    expect(listDueScheduledEntries).toHaveBeenCalledTimes(1);
  });

  it("does not count entries that were no longer eligible at publish time", async () => {
    const entry = dueEntry();

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => Promise.resolve(true),
      releaseLock: () => Promise.resolve(),
      listDueScheduledEntries: mock(() => Promise.resolve([entry])),
      publishScheduledEntryByIdAndWorkspace: mock(() => Promise.resolve(null)),
      logger,
      batchSize: 50,
    });

    await scheduler.runNow();

    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled entry publisher run complete",
      expect.objectContaining({ publishedCount: 0 }),
    );
  });

  it("skips a run when the advisory lock cannot be acquired", async () => {
    const listDueScheduledEntries = mock(() => Promise.resolve([]));

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => Promise.resolve(false),
      releaseLock: () => Promise.resolve(),
      listDueScheduledEntries,
      publishScheduledEntryByIdAndWorkspace: mock(() => Promise.resolve(null)),
      logger,
      batchSize: 50,
    });

    await scheduler.runNow();

    expect(listDueScheduledEntries).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled entry publisher skipped; advisory lock not acquired",
    );
  });

  it("releases the advisory lock after a publish failure", async () => {
    const releaseLock = mock(() => Promise.resolve());
    const error = new Error("boom");

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => Promise.resolve(true),
      releaseLock,
      listDueScheduledEntries: mock(() => Promise.resolve([dueEntry()])),
      publishScheduledEntryByIdAndWorkspace: mock(() => Promise.reject(error)),
      logger,
      batchSize: 50,
    });

    await scheduler.runNow();

    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Scheduled entry publisher run failed",
      expect.objectContaining({ error: "boom" }),
    );
  });

  it("logs advisory unlock failures", async () => {
    const unlockError = new Error("unlock failed");

    const scheduler = createScheduledEntryPublisher({
      tryAcquireLock: () => Promise.resolve(true),
      releaseLock: () => Promise.reject(unlockError),
      listDueScheduledEntries: mock(() => Promise.resolve([])),
      publishScheduledEntryByIdAndWorkspace: mock(() => Promise.resolve(null)),
      logger,
      batchSize: 50,
    });

    await scheduler.runNow();

    expect(logger.error).toHaveBeenCalledWith(
      "Scheduled entry publisher advisory unlock failed",
      { error: "unlock failed" },
    );
  });

  it("starts immediately, schedules polling, and stops cleanly", async () => {
    const scheduler = {
      runNow: mock(() => Promise.resolve()),
      stop: mock(() => undefined),
    };

    const publisher = startScheduledEntryPublisher({
      scheduler,
      pollIntervalMs: 60_000,
      logger,
    });

    publisher.stop();

    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled entry publisher starting",
      { pollIntervalMs: 60_000 },
    );
    expect(scheduler.runNow).toHaveBeenCalledTimes(1);
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
