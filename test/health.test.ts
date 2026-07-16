import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
    createGetHealth,
    resetHealthControllerCacheForTests,
    type CheckStatus,
    type HealthResponseBody,
} from "../src/controllers/health.controller";
import { createHealthRoute } from "../src/routes/health";

const okPing = () => Promise.resolve();
const failPing = () => Promise.reject(new Error("db down"));

interface BuildAppOptions {
    pingDb?: () => Promise<void>;
    uptimeSeconds?: number;
    version?: string;
    now?: () => number;
}

function buildApp(options: BuildAppOptions = {}) {
    const app = new Hono();
    app.get(
        "/health",
        createGetHealth({
            pingDb: options.pingDb ?? okPing,
            getUptimeSeconds: () => options.uptimeSeconds ?? 42,
            getVersion: () => options.version ?? "v0.1.0",
            now: options.now ?? (() => Date.now()),
        }),
    );
    return app;
}

async function readBody(res: Response): Promise<HealthResponseBody> {
    return (await res.json()) as HealthResponseBody;
}

describe("/health (HEALTHCHECK-CONTRACT.md §2 + §7)", () => {
    beforeEach(() => {
        resetHealthControllerCacheForTests();
    });

    test("§7.1 returns 200 + application/json with the contract shape", async () => {
        const app = buildApp();
        const res = await app.request("/health");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/application\/json/i);
        expect(await readBody(res)).toEqual({
            ok: true,
            service: "xynes-cms-core",
            version: "v0.1.0",
            uptime_seconds: 42,
            checks: { db: "ok" },
        });
    });

    test("§7.2 body matches the schema and declares db as the only check", async () => {
        const app = buildApp();
        const res = await app.request("/health");
        const body = await readBody(res);

        expect(typeof body.ok).toBe("boolean");
        expect(typeof body.service).toBe("string");
        expect(typeof body.version).toBe("string");
        expect(Number.isInteger(body.uptime_seconds)).toBe(true);
        expect(Object.keys(body.checks).sort()).toEqual(["db"]);
        const validStatuses: CheckStatus[] = ["ok", "fail", "skipped"];
        expect(validStatuses).toContain(body.checks.db);
    });

    test("§7.3 ok is true when the DB check passes", async () => {
        const app = buildApp({ pingDb: okPing });
        const res = await app.request("/health");

        expect(res.status).toBe(200);
        const body = await readBody(res);
        expect(body.ok).toBe(true);
        expect(body.checks.db).toBe("ok");
    });

    test("§7.4 returns 503 with ok=false when the DB check fails", async () => {
        const app = buildApp({ pingDb: failPing });
        const res = await app.request("/health");

        expect(res.status).toBe(503);
        const body = await readBody(res);
        expect(body.ok).toBe(false);
        expect(body.checks.db).toBe("fail");
    });

    test("§7.5 completes within the hot-path latency budget when mocked", async () => {
        const app = buildApp({ pingDb: okPing });
        const start = Date.now();
        const res = await app.request("/health");
        const elapsedMs = Date.now() - start;

        expect(res.status).toBe(200);
        expect(elapsedMs).toBeLessThan(200);
    });

    test("§7.6 requires no authentication", async () => {
        const app = buildApp();
        const res = await app.request("/health");

        expect(res.status).toBe(200);
        expect(res.headers.get("WWW-Authenticate")).toBeNull();
    });

    test("§7.7 response carries no authorization-leaking headers", async () => {
        const app = buildApp();
        const res = await app.request("/health");

        expect(res.headers.get("Set-Cookie")).toBeNull();
        expect(res.headers.get("Authorization")).toBeNull();
        for (const [name] of res.headers.entries()) {
            expect(name.toLowerCase().startsWith("x-xs-")).toBe(false);
        }
    });

    test("§7.8 body does not leak secrets, DB URLs, raw API keys, or stacks", async () => {
        const app = buildApp({
            pingDb: () =>
                Promise.reject(
                    new Error(
                        "connect ECONNREFUSED postgres://leak:s3cret@db.internal:5432/postgres; JWT_SECRET=super-secret; DATABASE_URL=postgres://leak; xynes_live_aabbccdd11223344",
                    ),
                ),
        });

        const res = await app.request("/health");
        const raw = await res.text();

        expect(raw).not.toMatch(/postgres:\/\//);
        expect(raw).not.toMatch(/JWT_SECRET/);
        expect(raw).not.toMatch(/DATABASE_URL/);
        expect(raw).not.toMatch(/xynes_live_/i);
        expect(raw).not.toMatch(/ECONNREFUSED/);
        expect(raw).not.toMatch(/\s+at\s+/);
    });

    test("caches DB probe failures for the documented TTL window", async () => {
        let pingCalls = 0;
        let nowMs = 1_000_000;
        const app = buildApp({
            pingDb: async () => {
                pingCalls += 1;
                throw new Error("transient db blip");
            },
            now: () => nowMs,
        });

        expect((await app.request("/health")).status).toBe(503);
        expect(pingCalls).toBe(1);

        nowMs += 5_000;
        expect((await app.request("/health")).status).toBe(503);
        expect(pingCalls).toBe(1);

        nowMs += 30_000;
        expect((await app.request("/health")).status).toBe(503);
        expect(pingCalls).toBe(2);
    });

    test("recovers from a cached failure after the probe succeeds", async () => {
        let nowMs = 1_000_000;
        let nextResult: "ok" | "fail" = "fail";
        const app = buildApp({
            pingDb: () =>
                nextResult === "ok"
                    ? Promise.resolve()
                    : Promise.reject(new Error("transient")),
            now: () => nowMs,
        });

        expect((await app.request("/health")).status).toBe(503);
        nowMs += 60_000;
        nextResult = "ok";
        expect((await app.request("/health")).status).toBe(200);
        expect((await app.request("/health")).status).toBe(200);
    });

    test("falls back to dev when XYNES_BUILD_VERSION is unset or blank", async () => {
        const originalVersion = process.env.XYNES_BUILD_VERSION;
        delete process.env.XYNES_BUILD_VERSION;
        try {
            const unsetApp = new Hono();
            unsetApp.get("/health", createGetHealth({ pingDb: okPing }));
            expect((await readBody(await unsetApp.request("/health"))).version).toBe(
                "dev",
            );

            process.env.XYNES_BUILD_VERSION = "   ";
            const blankApp = new Hono();
            blankApp.get("/health", createGetHealth({ pingDb: okPing }));
            expect((await readBody(await blankApp.request("/health"))).version).toBe(
                "dev",
            );
        } finally {
            if (originalVersion === undefined) {
                delete process.env.XYNES_BUILD_VERSION;
            } else {
                process.env.XYNES_BUILD_VERSION = originalVersion;
            }
        }
    });

    test("uses XYNES_BUILD_VERSION when set", async () => {
        const originalVersion = process.env.XYNES_BUILD_VERSION;
        process.env.XYNES_BUILD_VERSION = "v9.9.9";
        try {
            const app = new Hono();
            app.get("/health", createGetHealth({ pingDb: okPing }));
            expect((await readBody(await app.request("/health"))).version).toBe(
                "v9.9.9",
            );
        } finally {
            if (originalVersion === undefined) {
                delete process.env.XYNES_BUILD_VERSION;
            } else {
                process.env.XYNES_BUILD_VERSION = originalVersion;
            }
        }
    });

    test("DB probe is bounded by the 1s timeout", async () => {
        const neverResolves = () => new Promise<void>(() => undefined);
        const app = buildApp({ pingDb: neverResolves });
        const start = Date.now();
        const res = await app.request("/health");
        const elapsedMs = Date.now() - start;

        expect(res.status).toBe(503);
        expect((await readBody(res)).checks.db).toBe("fail");
        expect(elapsedMs).toBeLessThan(2_000);
    });
});

describe("/health route factory", () => {
    beforeEach(() => {
        resetHealthControllerCacheForTests();
    });

    test("createHealthRoute mounts at /health with injected deps", async () => {
        const route = createHealthRoute({
            pingDb: okPing,
            getUptimeSeconds: () => 7,
            getVersion: () => "v-test",
        });
        const app = new Hono();
        app.route("/", route);

        const res = await app.request("/health");
        expect(res.status).toBe(200);
        expect(await readBody(res)).toEqual({
            ok: true,
            service: "xynes-cms-core",
            version: "v-test",
            uptime_seconds: 7,
            checks: { db: "ok" },
        });
    });
});
