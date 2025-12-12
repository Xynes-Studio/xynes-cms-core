import { describe, expect, test, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createReadyRoute } from "../../src/routes/ready";

describe("Ready Endpoint (Unit)", () => {
    let checkMock: ReturnType<typeof mock>;

    beforeEach(() => {
        checkMock = mock();
    });

    test("GET /ready returns 200 when DB is reachable", async () => {
        const app = new Hono();
        checkMock.mockResolvedValueOnce(undefined);
        app.route(
            "/ready",
            createReadyRoute({ getDatabaseUrl: () => "postgres://unused", check: checkMock })
        );

        const res = await app.request("/ready");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ready" });
        expect(checkMock).toHaveBeenCalledTimes(1);
        expect(checkMock).toHaveBeenCalledWith({ databaseUrl: "postgres://unused", schemaName: "cms" });
    });

    test("GET /ready returns 503 when DB is unreachable", async () => {
        const app = new Hono();
        checkMock.mockRejectedValueOnce(new Error("db down"));
        app.route(
            "/ready",
            createReadyRoute({ getDatabaseUrl: () => "postgres://unused", check: checkMock })
        );

        const res = await app.request("/ready");
        expect(res.status).toBe(503);
        const body = await res.json() as any;
        expect(body.status).toBe("not_ready");
        expect(body.error).toContain("db down");
        expect(checkMock).toHaveBeenCalledTimes(1);
        expect(checkMock).toHaveBeenCalledWith({ databaseUrl: "postgres://unused", schemaName: "cms" });
    });
});
