import { describe, expect, it } from "bun:test";
import {
  createPublicationSmokeClient,
  runPublicationSmoke,
  SmokeRequestError,
} from "../../scripts/lib/publication-smoke";

const id = "00000000-0000-4000-8000-000000000001";
function fixture(fault?: string) {
  let title = "";
  let snapshot: unknown = null;
  let invalid = false;
  let deleted = false;
  const calls: string[] = [];
  const deps = {
    preflight: async () => {
      if (fault === "schema") throw new Error("Migration 0008 required");
    },
    inspect: async () => snapshot,
    report: (_label: string) => {},
    action: async (key: string, payload: Record<string, unknown>) => {
      calls.push(key);
      if (key === "cms.entry.listByDirectory")
        return { items: fault === "list" ? null : [] };
      if (key === "cms.entry.delete") {
        deleted = true;
        return { success: true };
      }
      if (key === "cms.entry.create") {
        title = String(payload.title);
        return { entry: { id, status: "draft", deliveryState: "unpublished" } };
      }
      if (key === "cms.entry.update") {
        title = String(payload.title ?? title);
        invalid = JSON.stringify(payload.body ?? {}).includes("access_token");
        if (fault === "draft-leak") snapshot = { version: 1, entry: { title } };
        return {
          entry: { id, status: "published", deliveryState: "available" },
        };
      }
      if (key === "cms.entry.publish" || payload.status === "published") {
        if (fault === "publish") throw new Error("publish failed");
        if (invalid && fault !== "accept-invalid")
          throw new SmokeRequestError(
            "cms.entry.publish",
            400,
            "PUBLICATION_INVALID",
          );
        snapshot = { version: 1, entry: { id, title } };
        return {
          entry: {
            id,
            status: "published",
            deliveryState: fault === "state" ? "unpublished" : "available",
          },
        };
      }
      return {
        entry: { id, status: payload.status, deliveryState: "unpublished" },
      };
    },
  };
  return { deps, calls, deleted: () => deleted };
}

describe("publication environment smoke", () => {
  it("exercises list, publication isolation, rejection, lifecycle and cleanup", async () => {
    const f = fixture();
    await runPublicationSmoke(f.deps);
    expect(f.deleted()).toBe(true);
    expect(f.calls).toContain("cms.entry.status.set");
  });
  it("does no API writes when the migration preflight fails", async () => {
    const f = fixture("schema");
    await expect(runPublicationSmoke(f.deps)).rejects.toThrow("Migration 0008");
    expect(f.calls).toEqual([]);
  });
  it("does no writes when the authoring list is broken", async () => {
    const f = fixture("list");
    await expect(runPublicationSmoke(f.deps)).rejects.toThrow("list");
    expect(f.calls).toEqual(["cms.entry.listByDirectory"]);
  });
  for (const fault of ["publish", "draft-leak", "accept-invalid", "state"]) {
    it(`detects ${fault} and cleans up its created entry`, async () => {
      const f = fixture(fault);
      await expect(runPublicationSmoke(f.deps)).rejects.toThrow();
      expect(f.deleted()).toBe(true);
    });
  }
});

describe("smoke HTTP boundary", () => {
  const options = {
    url: "http://localhost:4202",
    token: "private-token",
    workspaceId: id,
    userId: id,
    timeoutMs: 50,
  };
  it("sends real internal headers, an action envelope and a bounded signal", async () => {
    let seen: Request | undefined;
    const client = createPublicationSmokeClient(options, async (request) => {
      seen = new Request(request);
      return Response.json({ ok: true, data: { items: [] } });
    });
    expect(await client("cms.entry.listByDirectory", { limit: 1 })).toEqual({
      items: [],
    });
    expect(seen?.headers.get("X-Internal-Service-Token")).toBe(options.token);
    expect(seen?.headers.get("X-XS-User-Id")).toBe(id);
    expect(seen?.signal).toBeDefined();
    expect(await seen?.json()).toEqual({
      actionKey: "cms.entry.listByDirectory",
      payload: { limit: 1 },
    });
  });
  it("reports HTTP status and safe code without leaking response content or credentials", async () => {
    const client = createPublicationSmokeClient(options, async () =>
      Response.json(
        { error: { code: "PUBLICATION_INVALID", message: "private-token" } },
        { status: 400 },
      ),
    );
    await expect(client("cms.entry.publish", {})).rejects.toThrow(
      "HTTP 400 PUBLICATION_INVALID",
    );
    try {
      await client("cms.entry.publish", {});
    } catch (error) {
      expect(String(error)).not.toContain(options.token);
    }
  });
  it("rejects malformed or unsuccessful envelopes even with HTTP 200", async () => {
    for (const body of [
      "not-json",
      JSON.stringify({ ok: false }),
      JSON.stringify({ ok: true, data: null }),
    ]) {
      const client = createPublicationSmokeClient(
        options,
        async () => new Response(body),
      );
      await expect(client("cms.entry.publish", {})).rejects.toThrow();
    }
  });
  it("redacts thrown network errors", async () => {
    const client = createPublicationSmokeClient(options, async () => {
      throw new Error("private-token");
    });
    await expect(client("cms.entry.publish", {})).rejects.toThrow(
      "request failed or timed out",
    );
  });
});

describe("publication smoke CLI safeguards", () => {
  it("requires explicit fixture-write opt-in before accessing services or a database", async () => {
    const child = Bun.spawn(
      [process.execPath, "run", "scripts/smoke-publication.ts"],
      {
        env: {
          PATH: process.env.PATH,
          SMOKE_ALLOW_WRITES: "false",
          DATABASE_URL: "postgres://private-token@invalid/db",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(output).toContain("SMOKE_ALLOW_WRITES=true");
    expect(output).not.toContain("private-token");
  });
});

it("bounds a real unresponsive HTTP server without exposing request credentials", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  const client = createPublicationSmokeClient({
    url: `http://127.0.0.1:${server.port}`,
    token: "private-token",
    workspaceId: id,
    userId: id,
    timeoutMs: 50,
  });
  const started = performance.now();
  try {
    await expect(client("cms.entry.listByDirectory", {})).rejects.toThrow(
      "request failed or timed out",
    );
    expect(performance.now() - started).toBeLessThan(1500);
  } finally {
    server.stop(true);
  }
});

it("rejects incomplete CLI configuration before opening a database", async () => {
  const child = Bun.spawn(
    [process.execPath, "run", "scripts/smoke-publication.ts"],
    {
      env: {
        PATH: process.env.PATH,
        SMOKE_ALLOW_WRITES: "true",
        DATABASE_URL: "postgres://private-token@invalid/db",
        WORKSPACE_ID: "invalid",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(output).toContain("Set valid DATABASE_URL");
  expect(output).not.toContain("private-token");
});

for (const code of ["42703", "08006"]) {
  it(`reports safe database preflight guidance for ${code} without making API writes`, async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const directory = await mkdtemp("/private/tmp/cms-smoke-cli-case-");
    const harness = `${directory}/preflight.test.ts`;
    const script = `${process.cwd()}/scripts/smoke-publication.ts`;
    const postgresModule = Bun.resolveSync("postgres", process.cwd());
    await Bun.write(
      harness,
      `import {mock,test,expect} from "bun:test";
mock.module(${JSON.stringify(postgresModule)},()=>({default:()=>Object.assign(async()=>{throw {code:${JSON.stringify(code)},message:"private-token"}}, {end:async()=>{}})}));
await import(${JSON.stringify(script)});
test("preflight fails closed",()=>{expect(process.exitCode).toBe(1);process.exitCode=0;});`,
    );
    try {
      const coverage = process.env.SMOKE_CLI_COVERAGE_DIR;
      const child = Bun.spawn(
        [
          process.execPath,
          "test",
          harness,
          ...(coverage
            ? [
                "--coverage",
                "--coverage-reporter=lcov",
                `--coverage-dir=${coverage}/${code}`,
              ]
            : []),
        ],
        {
          env: {
            PATH: process.env.PATH,
            SMOKE_ALLOW_WRITES: "true",
            DATABASE_URL: "postgres://private-token@invalid/db",
            INTERNAL_SERVICE_TOKEN: "private-token",
            WORKSPACE_ID: id,
            XS_USER_ID: id,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(output).toContain(
        code === "42703"
          ? "CMS migration 0008 is required"
          : "CMS database preflight failed",
      );
      expect(output).not.toContain("private-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
