import { describe, expect, test } from "bun:test";
import service from "../../src/index";

describe("Ready Endpoint (Integration)", () => {
    test("GET /ready returns 200 when DB is reachable", async () => {
        const res = await service.fetch(new Request("http://localhost/ready"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: "ready" });
    });
});
