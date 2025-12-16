import { describe, it, expect, vi, beforeEach } from "bun:test";
import { Hono } from "hono";
import { requireInternalServiceAuth } from "../../../src/middleware/internal-service-auth";

describe("requireInternalServiceAuth (unit)", () => {
  const token = "unit-test-token";

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = token;
  });

  it("returns 401 when header is missing and does not call handler", async () => {
    const app = new Hono();
    const handler = vi.fn((c) => c.json({ ok: true }));
    app.use("*", requireInternalServiceAuth());
    app.post("/internal/cms-actions", handler);

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when header is mismatched and does not call handler", async () => {
    const app = new Hono();
    const handler = vi.fn((c) => c.json({ ok: true }));
    app.use("*", requireInternalServiceAuth());
    app.post("/internal/cms-actions", handler);

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": "wrong-token",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows request when header matches", async () => {
    const app = new Hono();
    const handler = vi.fn((c) => c.json({ ok: true }));
    app.use("*", requireInternalServiceAuth());
    app.post("/internal/cms-actions", handler);

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": token,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

