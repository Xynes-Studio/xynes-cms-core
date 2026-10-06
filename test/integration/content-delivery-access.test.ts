import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { type Handler, Hono } from "hono";
import postgres from "postgres";
import { z } from "zod";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import {
  createEntry,
  publishEntryByIdAndWorkspace,
  updateEntryByIdAndWorkspaceScoped,
} from "../../src/infra/db/repositories/content-entry.repository";
import { contentDirectories, contentTypes } from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";
import { guardedPostgresEnvironment } from "./libpq-env";

const enabled = process.env.RUN_CMS_DELIVERY_ACCESS_TESTS === "true";
const repos = {
  gateway: process.env.XYNES_GATEWAY_REPO,
  accounts: process.env.XYNES_ACCOUNTS_REPO,
  infra: process.env.XYNES_INFRA_REPO,
};
const routeSchema = z.object({
  id: z.string(),
  method: z.string(),
  pathPattern: z.string(),
  serviceKey: z.string(),
  actionKey: z.string(),
  workspaceScoped: z.boolean(),
  isPublic: z.boolean(),
});
const issuedSchema = z.object({
  id: z.string().uuid(),
  rawKey: z.string(),
  scopes: z.array(z.string()),
});
const listSchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        items: z.array(
          z.object({ id: z.string(), title: z.string().optional() }).strict(),
        ),
        page: z
          .object({
            limit: z.number(),
            offset: z.number(),
            hasMore: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    meta: z.unknown().optional(),
  })
  .strict();
const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string() }).passthrough(),
  meta: z.unknown().optional(),
});
type Issuer = (dependencies: {
  authzClient: {
    checkPermission: (request: {
      userId: string;
      workspaceId: string | null;
      actionKey: string;
    }) => Promise<boolean>;
    assignRole: () => Promise<void>;
    listRolesForWorkspace: () => Promise<[]>;
  };
}) => (
  payload: { name: string; presetKey: string; expiresAt?: string },
  context: {
    workspaceId: string;
    userId: string;
    requestId: string;
  },
) => Promise<unknown>;

function construct(ctor: unknown, args: unknown[]): unknown {
  if (typeof ctor !== "function")
    throw new Error("Fixture constructor unavailable");
  return Reflect.construct(ctor, args);
}

// Opt-in only: runner backs up and prepares a disposable schema. Missing enabled prerequisites fail.
describe.skipIf(!enabled)(
  "registered read-only delivery access (isolated DB and HTTP)",
  () => {
    const workspaceId = crypto.randomUUID();
    const foreignWorkspace = crypto.randomUUID();
    const folder = crypto.randomUUID();
    const emptyFolder = crypto.randomUUID();
    const userId = crypto.randomUUID();
    let temporary = "";
    let gateway: ReturnType<typeof Bun.serve> | undefined;
    let cms: ReturnType<typeof Bun.serve> | undefined;
    let previousCmsCoreUrl: string | undefined;
    let cmsCoreUrlOverridden = false;
    let sql: ReturnType<typeof postgres>;
    let issue: ReturnType<Issuer>;
    let current: z.infer<typeof issuedSchema>;
    let old: z.infer<typeof issuedSchema>;
    let entryId: string;
    let refreshRoutes: () => Promise<z.infer<typeof routeSchema>[]>;
    let reloadGateway: () => Promise<void>;
    const actions = ["cms.delivery.listByDirectory", "cms.delivery.getById"];
    const setup = async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.search ||
        url.hash ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !/^\/cms_int_a4_[a-z0-9_]+$/.test(url.pathname)
      )
        throw new Error(
          "Requires an explicitly disposable cms_int_a4_* loopback database",
        );
      if (!repos.gateway || !repos.accounts || !repos.infra)
        throw new Error("Explicit A4 checkout paths required");
      temporary = await mkdtemp(join(tmpdir(), "cms-a4-access-"));
      sql = postgres(url.href, { max: 1, prepare: false, onnotice: () => {} });
      cms = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
      previousCmsCoreUrl = process.env.CMS_CORE_URL;
      process.env.CMS_CORE_URL = cms.url.origin;
      cmsCoreUrlOverridden = true;
      // Source paths are JSON-encoded into a trusted temporary build input, never evaluated user code.
      const wrapper = join(temporary, "runtime.ts");
      await writeFile(
        wrapper,
        [
          `export {DynamicRouter} from ${JSON.stringify(join(repos.gateway, "src/router/dynamicRouter.ts"))};`,
          `export {PostgresRouteRepository} from ${JSON.stringify(join(repos.gateway, "src/data/postgresRouteRepository.ts"))};`,
          `export {PostgresWorkspaceApiKeyRepository} from ${JSON.stringify(join(repos.gateway, "src/data/postgresWorkspaceApiKeyRepository.ts"))};`,
          `export {createCreateApiKeyHandler} from ${JSON.stringify(join(repos.accounts, "src/actions/handlers/integrations/apiKeys.ts"))};`,
        ].join("\n"),
      );
      const build = await Bun.build({
        entrypoints: [wrapper],
        target: "bun",
        outdir: temporary,
      });
      if (!build.success)
        throw new Error("A4 actual-source runtime build failed");
      const runtime: unknown = await import(
        pathToFileURL(join(temporary, "runtime.js")).href
      );
      const module = z
        .object({
          DynamicRouter: z.unknown(),
          PostgresRouteRepository: z.unknown(),
          PostgresWorkspaceApiKeyRepository: z.unknown(),
          createCreateApiKeyHandler: z.custom<Issuer>(
            (v) => typeof v === "function",
          ),
        })
        .parse(runtime);
      for (const ctor of [
        module.DynamicRouter,
        module.PostgresRouteRepository,
        module.PostgresWorkspaceApiKeyRepository,
      ])
        if (typeof ctor !== "function")
          throw new Error("Fixture constructor unavailable");
      await sql`insert into identity.users (id,email) values (${userId}, ${userId + "@fixture.invalid"})`;
      await sql`insert into platform.workspaces (id) values (${workspaceId}), (${foreignWorkspace})`;
      issue = module.createCreateApiKeyHandler({
        authzClient: {
          checkPermission: async (request) =>
            request.userId === userId &&
            request.workspaceId === workspaceId &&
            request.actionKey === "platform.api_keys.create",
          assignRole: async () => {},
          listRolesForWorkspace: async () => [],
        },
      });
      old = issuedSchema.parse(
        await issue(
          { name: "Old fixture key", presetKey: "cms_readonly" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      // Reproduce a key issued before A4; its durable scopes must remain unchanged by route migration/new issuance.
      await sql`delete from platform.workspace_api_key_scopes where api_key_id = ${old.id} and action_key in (${actions[0]},${actions[1]})`;
      await sql`insert into platform.routes (method,path_pattern,service_key,target_path,action_key,is_public,workspace_scoped)
      values ('GET','/fixture-unrelated','cms-core','/internal/cms-actions','cms.entry.getById',false,false)`;
      const priorKeys =
        await sql`select * from platform.workspace_api_keys order by id`;
      const priorScopes =
        await sql`select * from platform.workspace_api_key_scopes order by api_key_id,action_key`;
      const priorRoute =
        await sql`select * from platform.routes where path_pattern='/fixture-unrelated'`;
      const backup = join(temporary, "before-routes.dump");
      const dump = Bun.spawnSync(
        [process.env.PG_DUMP_BIN ?? "pg_dump", "-Fc", "-f", backup],
        {
          env: guardedPostgresEnvironment(url),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      if (dump.exitCode !== 0)
        throw new Error("Isolated pre-migration backup failed");
      await chmod(backup, 0o600);
      const migration = await readFile(
        join(
          repos.infra,
          "supabase/migrations/20261005090000_seed_cms_delivery_routes.sql",
        ),
        "utf8",
      );
      expect(
        await sql`select id from platform.routes where action_key like 'cms.delivery.%'`,
      ).toHaveLength(0);
      await sql.unsafe(migration);
      await sql.unsafe(migration);
      expect(
        JSON.stringify(
          await sql`select * from platform.workspace_api_keys order by id`,
        ),
      ).toBe(JSON.stringify(priorKeys));
      expect(
        JSON.stringify(
          await sql`select * from platform.workspace_api_key_scopes order by api_key_id,action_key`,
        ),
      ).toBe(JSON.stringify(priorScopes));
      expect(
        JSON.stringify(
          await sql`select * from platform.routes where path_pattern='/fixture-unrelated'`,
        ),
      ).toBe(JSON.stringify(priorRoute));
      expect(
        await sql`select id from platform.routes where action_key like 'cms.delivery.%'`,
      ).toHaveLength(2);
      current = issuedSchema.parse(
        await issue(
          { name: "New fixture key", presetKey: "cms_readonly" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      expect(current.scopes).toEqual(expect.arrayContaining(actions));
      expect(current.scopes).toHaveLength(6);
      expect(
        await sql`select action_key from platform.workspace_api_key_scopes where api_key_id=${old.id}`,
      ).toHaveLength(4);
      const repository = construct(module.PostgresRouteRepository, [
        { databaseUrl: url.href },
      ]);
      const getRoutes = z
        .object({
          getRoutes: z.custom<() => Promise<unknown>>(
            (v) => typeof v === "function",
          ),
        })
        .parse(repository).getRoutes;
      refreshRoutes = async () =>
        z.array(routeSchema).parse(await getRoutes.call(repository));
      const keys = construct(module.PostgresWorkspaceApiKeyRepository, [
        { databaseUrl: url.href },
      ]);
      reloadGateway = async () => {
        const routes = await refreshRoutes();
        const router = construct(module.DynamicRouter, [
          {
            routes,
            apiKeyRepository: keys,
            authzService: {
              check: async () => {
                throw new Error("Key reads must not invoke user authz");
              },
            },
          },
        ]);
        const handler = z
          .object({ handle: z.custom<Handler>((v) => typeof v === "function") })
          .parse(router).handle;
        const boundary = new Hono();
        boundary.all("*", handler);
        gateway?.stop(true);
        gateway = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: boundary.fetch,
        });
      };
      await reloadGateway();
      await runSeed(db, workspaceId);
      const [type] = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      await db.insert(contentDirectories).values([
        { id: folder, workspaceId, name: "Delivery", pathSegment: "delivery" },
        { id: emptyFolder, workspaceId, name: "Empty", pathSegment: "empty" },
      ]);
      const entry = await createEntry({
        workspaceId,
        contentTypeId: type.id,
        directoryId: folder,
        status: "published",
        data: { slug: "a4", title: "123", description: "Published", tags: [] },
      });
      entryId = entry.id;
    };
    async function teardown() {
      try {
        gateway?.stop(true);
        cms?.stop(true);
        if (sql) await sql.end();
        if (temporary) await rm(temporary, { recursive: true, force: true });
      } finally {
        if (cmsCoreUrlOverridden) {
          if (previousCmsCoreUrl === undefined) delete process.env.CMS_CORE_URL;
          else process.env.CMS_CORE_URL = previousCmsCoreUrl;
        }
      }
      // The launcher owns the entire disposable DB; no tenant cleanup against a shared database.
    }
    beforeAll(async () => {
      try {
        await setup();
      } catch (error) {
        // Bun can skip a suite's afterAll when its beforeAll fails.
        await teardown();
        throw error;
      }
    }, 30000);
    afterAll(teardown);
    async function request(path: string, key = current.rawKey) {
      if (!gateway) throw new Error("Gateway not started");
      return fetch(new URL(path, gateway.url), {
        headers: { "X-XS-API-Key": key },
      });
    }
    const path = `/workspaces/${workspaceId}/delivery/entries`;
    it("returns bounded projected published list/detail and a real empty feed", async () => {
      const list = await request(
        `${path}?directoryId=${folder}&limit=1&offset=0&fields=title&search=123`,
      );
      expect(list.status).toBe(200);
      expect(listSchema.parse(await list.json()).data).toEqual({
        items: [{ id: entryId, title: "123" }],
        page: { limit: 1, offset: 0, hasMore: false },
      });
      const detail = await request(`${path}/${entryId}?fields=id,title`);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({
        ok: true,
        data: { entry: { id: entryId, title: "123" } },
      });
      const empty = await request(`${path}?directoryId=${emptyFolder}`);
      expect(empty.status).toBe(200);
      expect(listSchema.parse(await empty.json()).data.items).toEqual([]);
    });
    it("requires explicit replacement of an old key and denies authoring scope", async () => {
      const response = await request(
        `${path}?directoryId=${folder}`,
        old.rawKey,
      );
      expect(response.status).toBe(403);
      expect(errorSchema.parse(await response.json()).error.code).toBe(
        "FORBIDDEN",
      );
      const author = issuedSchema.parse(
        await issue(
          { name: "Author fixture", presetKey: "cms_authoring" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      expect(
        (await request(`${path}?directoryId=${folder}`, author.rawKey)).status,
      ).toBe(403);
    });
    it("enforces foreign workspace, expired and revoked keys through real stored hashes", async () => {
      expect(
        (
          await request(
            `/workspaces/${foreignWorkspace}/delivery/entries?directoryId=${folder}`,
          )
        ).status,
      ).toBe(403);
      const expired = issuedSchema.parse(
        await issue(
          {
            name: "Expired fixture",
            presetKey: "cms_readonly",
            expiresAt: "2000-01-01T00:00:00Z",
          },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      expect(
        (await request(`${path}?directoryId=${folder}`, expired.rawKey)).status,
      ).toBe(401);
      const revoked = issuedSchema.parse(
        await issue(
          { name: "Revoked fixture", presetKey: "cms_readonly" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      await sql`update platform.workspace_api_keys set status='revoked',revoked_at=now(),revoked_by=${userId} where id=${revoked.id}`;
      expect(
        (await request(`${path}?directoryId=${folder}`, revoked.rawKey)).status,
      ).toBe(401);
    });
    it("rejects malformed/ambiguous queries through gateway and CMS without broader fallback", async () => {
      for (const query of [
        "limit=101",
        "limit=-1",
        "limit=1.5",
        "offset=10001",
        "limit=0x10",
        "limit=",
        "fields=title,,id",
        "fields=body",
        "preview=true",
        "directoryId=bad",
        `directoryId=${folder}&directoryId=${emptyFolder}`,
        `workspaceId=${foreignWorkspace}`,
        `entryId=${crypto.randomUUID()}`,
      ]) {
        const target = query.startsWith("entryId=")
          ? `${path}/${entryId}?${query}`
          : `${path}?directoryId=${folder}&${query}`;
        const response = await request(target);
        expect(response.status).toBe(400);
        expect(errorSchema.parse(await response.json()).error.code).toBe(
          "VALIDATION_ERROR",
        );
      }
      expect((await request(`${path}`)).status).toBe(400);
      expect((await request(`${path}/${crypto.randomUUID()}`)).status).toBe(
        404,
      );
    });
    it("serves the prior publication after save and advances only on republish", async () => {
      await updateEntryByIdAndWorkspaceScoped({
        entryId,
        workspaceId,
        data: {
          slug: "a4",
          title: "Draft",
          description: "Published",
          tags: [],
        },
      });
      expect(
        await (await request(`${path}/${entryId}?fields=title`)).json(),
      ).toMatchObject({ data: { entry: { title: "123" } } });
      await publishEntryByIdAndWorkspace({ entryId, workspaceId });
      expect(
        await (await request(`${path}/${entryId}?fields=title`)).json(),
      ).toMatchObject({ data: { entry: { title: "Draft" } } });
    });
    it("removes disabled delivery routes on refresh while retaining other routes and scopes", async () => {
      await sql`update platform.routes set enabled=false where action_key in (${actions[0]},${actions[1]})`;
      await reloadGateway();
      expect((await request(`${path}?directoryId=${folder}`)).status).toBe(404);
      expect((await request(`${path}/${entryId}`)).status).toBe(404);
      const refreshed = await refreshRoutes();
      expect(
        refreshed.filter((route) =>
          route.actionKey.startsWith("cms.delivery."),
        ),
      ).toEqual([]);
      expect(
        refreshed.some((route) => route.pathPattern === "/fixture-unrelated"),
      ).toBe(true);
      expect(
        await sql`select action_key from platform.workspace_api_key_scopes where api_key_id=${current.id}`,
      ).toHaveLength(6);
    });
  },
);
