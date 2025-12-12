import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import service from "../../src/index";
import { createReadyRoute } from "../../src/routes/ready";

describe("Ready Endpoint (Integration)", () => {
    test("GET /ready returns 200 when DB is reachable", async () => {
        const res = await service.fetch(new Request("http://localhost/ready"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: "ready" });
    });

    test("GET /ready returns 503 when DB is unreachable", async () => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error("DATABASE_URL is required for this test");

        const invalidUrl = (() => {
            const url = new URL(databaseUrl);
            url.hostname = "127.0.0.1";
            url.port = "1";
            return url.toString();
        })();

        const failingApp = new Hono();
        failingApp.route("/ready", createReadyRoute({ getDatabaseUrl: () => invalidUrl }));
        const failingRes = await failingApp.request("/ready");
        expect(failingRes.status).toBe(503);
        const failingBody = await failingRes.json() as any;
        expect(failingBody.status).toBe("not_ready");
        expect(failingBody.error).toBeDefined();
    });
});
