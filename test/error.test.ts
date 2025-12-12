import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error-handler";

describe("Error Handler", () => {
    test("Should catch errors and return 500", async () => {
        const app = new Hono();
        app.onError(errorHandler);
        app.get("/error", () => {
            throw new Error("Test error");
        });

        const res = await app.request("/error");
        expect(res.status).toBe(500);
        const body = await res.json() as any;
        expect(body.ok).toBe(false);
        expect(body.error).toEqual({ code: "INTERNAL_ERROR", message: "Internal server error" });
        expect(body.meta.requestId).toBeDefined();
    });

    test("Should handle errors without message", async () => {
        const app = new Hono();
        app.onError(errorHandler);
        app.get("/unknown-error", () => {
            throw "String error"; // Not an Error object, so err.message might be undefined or different
        });
        // Or strictly:
        app.get("/empty-error", () => {
            const e = new Error();
            e.message = ""; // empty message
            throw e;
        });

        const res = await app.request("/empty-error");
        expect(res.status).toBe(500);
        const body = await res.json() as any;
        expect(body.ok).toBe(false);
        expect(body.error.message).toBe("Internal server error");
        expect(body.meta.requestId).toBeDefined();
    });
});
