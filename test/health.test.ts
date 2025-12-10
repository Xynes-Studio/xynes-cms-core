import { describe, expect, test } from "bun:test";
import app from "../src/index";

describe("Health Endpoint", () => {
    test("GET /health should return 200 OK", async () => {
        const res = await app.fetch(new Request("http://localhost/health"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ status: "ok" });
    });
});
