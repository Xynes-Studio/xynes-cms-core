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
import { createScheduledEntryPublisher } from "../../src/scheduling/scheduled-entry-publisher";
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
    it("denies create-with-publish before any persisted side effect through the real gateway", async () => {
      await sql`insert into platform.routes (method,path_pattern,service_key,target_path,action_key,is_public,workspace_scoped)
        values ('POST','/workspaces/:workspaceId/fixture/entries','cms-core','/internal/cms-actions','cms.entry.create',false,true)`;
      await reloadGateway();
      const author = issuedSchema.parse(
        await issue(
          { name: "Compound author fixture", presetKey: "cms_authoring" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      const before =
        await sql`select * from cms.content_entries where workspace_id=${workspaceId} order by id`;
      if (!gateway) throw new Error("Gateway not started");
      const response = await fetch(
        new URL(`/workspaces/${workspaceId}/fixture/entries`, gateway.url),
        {
          method: "POST",
          headers: {
            "X-XS-API-Key": author.rawKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "Compound publication fixture",
            directoryId: folder,
            publishNow: true,
          }),
        },
      );
      expect(response.status).toBe(403);
      expect(errorSchema.parse(await response.json()).error.code).toBe(
        "FORBIDDEN",
      );
      expect(
        JSON.stringify(
          await sql`select * from cms.content_entries where workspace_id=${workspaceId} order by id`,
        ),
      ).toBe(JSON.stringify(before));
    });
    it("denies every legacy publication flag and status transition before database changes", async () => {
      const routeActions = [
        "cms.content.create",
        "cms.blog_entry.create",
        "cms.blog_entry.updateMeta",
        "cms.entry.status.set",
      ];
      for (const [index, action] of routeActions.entries()) {
        await sql`insert into platform.routes (method,path_pattern,service_key,target_path,action_key,is_public,workspace_scoped)
          values ('POST',${"/workspaces/:workspaceId/fixture/effect-" + index},'cms-core','/internal/cms-actions',${action},false,true)`;
      }
      await reloadGateway();
      const key = issuedSchema.parse(
        await issue(
          { name: "Synthetic base-permission key", presetKey: "cms_authoring" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      // Synthetic custom scopes prove each base permission is allowed while
      // the hidden publish/withdraw permission is absent. Not preset expansion.
      for (const action of routeActions.filter(
        (action) => action !== "cms.entry.status.set",
      ))
        await sql`insert into platform.workspace_api_key_scopes(api_key_id,action_key) values(${key.id},${action}) on conflict do nothing`;
      const [type] =
        await sql`select id from cms.content_types where workspace_id=${workspaceId} and template_key='blog_post'`;
      const base = {
        contentTypeId: String(type.id),
        data: { slug: "denied-effect", title: "Denied effect" },
      };
      const requests: [number, unknown][] = [
        [0, { ...base, publishNow: true }],
        [
          0,
          {
            ...base,
            publishNow: false,
            data: { ...base.data, publishNow: true },
          },
        ],
        [
          0,
          {
            ...base,
            data: { ...base.data, publishedAt: "2030-01-01T00:00:00Z" },
          },
        ],
        [1, { ...base, publishNow: true }],
        [1, { ...base, data: { ...base.data, publishNow: true } }],
        [
          1,
          {
            ...base,
            data: { ...base.data, publishedAt: "2030-01-01T00:00:00Z" },
          },
        ],
        [2, { id: entryId, publishNow: true }],
        [2, { id: entryId, unpublish: true }],
        [3, { entryId, status: "published" }],
        [
          3,
          { entryId, status: "scheduled", publishAt: "2030-01-01T00:00:00Z" },
        ],
      ];
      const snapshot = async () =>
        JSON.stringify(
          await sql`select * from cms.content_entries where workspace_id=${workspaceId} order by id`,
        );
      const before = await snapshot();
      for (const [index, payload] of requests) {
        if (index === 3)
          await sql`insert into platform.workspace_api_key_scopes(api_key_id,action_key) values(${key.id},'cms.entry.status.set') on conflict do nothing`;
        if (!gateway) throw new Error("Gateway not started");
        const response = await fetch(
          new URL(
            `/workspaces/${workspaceId}/fixture/effect-${index}`,
            gateway.url,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-XS-API-Key": key.rawKey,
            },
            body: JSON.stringify(payload),
          },
        );
        expect(response.status).toBe(403);
        expect(errorSchema.parse(await response.json()).error.code).toBe(
          "FORBIDDEN",
        );
        expect(await snapshot()).toBe(before);
      }
    });
    it("persists exactly the inherited Publisher scopes and publishes via signed context", async () => {
      const publisher = issuedSchema.parse(
        await issue(
          { name: "Inherited Publisher fixture", presetKey: "cms_publisher" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      const expected = [
        "cms.content.listPublished",
        "cms.content.getPublishedBySlug",
        "cms.blog_entry.listPublished",
        "cms.blog_entry.getPublishedBySlug",
        "cms.delivery.listByDirectory",
        "cms.delivery.getById",
        "cms.entry.create",
        "cms.entry.update",
        "cms.entry.getById",
        "cms.entry.listByDirectory",
        "cms.entry.publish",
        "cms.entry.status.set",
      ];
      expect([...publisher.scopes].sort()).toEqual([...expected].sort());
      expect(
        (
          await sql`select action_key from platform.workspace_api_key_scopes where api_key_id=${publisher.id}`
        )
          .map((row) => row.action_key)
          .sort(),
      ).toEqual([...expected].sort());
      if (!gateway) throw new Error("Gateway not started");
      const response = await fetch(
        new URL(`/workspaces/${workspaceId}/fixture/entries`, gateway.url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-XS-API-Key": publisher.rawKey,
          },
          body: JSON.stringify({
            title: "Publisher success fixture",
            directoryId: folder,
            publishNow: true,
          }),
        },
      );
      expect(response.status).toBe(200);
      const result = z
        .object({
          data: z.object({
            data: z.object({ entry: z.object({ id: z.string().uuid() }) }),
          }),
        })
        .parse(await response.json());
      const detail = await request(
        `${path}/${result.data.data.entry.id}?fields=id,title`,
        publisher.rawKey,
      );
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({
        data: {
          entry: {
            id: result.data.data.entry.id,
            title: "Publisher success fixture",
          },
        },
      });
    });
    it("keeps gateway status, move, invalid republish and due scheduling on one committed snapshot", async () => {
      const publisher = issuedSchema.parse(
        await issue(
          { name: "Synthetic matrix Publisher", presetKey: "cms_publisher" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      for (const [operation, action] of [
        ["update", "cms.entry.update"],
        ["publish", "cms.entry.publish"],
        ["status", "cms.entry.status.set"],
        ["delete", "cms.entry.delete"],
      ]) {
        await sql`insert into platform.routes (method,path_pattern,service_key,target_path,action_key,is_public,workspace_scoped) values ('POST',${`/workspaces/:workspaceId/fixture/matrix-${operation}`},'cms-core','/internal/cms-actions',${action},false,true)`;
      }
      await reloadGateway();
      async function write(operation: string, payload: unknown) {
        if (!gateway) throw new Error("Gateway not started");
        return fetch(
          new URL(
            `/workspaces/${workspaceId}/fixture/${operation}`,
            gateway.url,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-XS-API-Key": publisher.rawKey,
            },
            body: JSON.stringify(payload),
          },
        );
      }
      const created = await write("entries", {
        title: "Matrix A",
        directoryId: folder,
      });
      expect(created.status).toBe(200);
      const result = z
        .object({
          data: z.object({
            data: z.object({ entry: z.object({ id: z.string().uuid() }) }),
          }),
        })
        .parse(await created.json());
      const id = result.data.data.entry.id;
      const detail = () =>
        request(`${path}/${id}?fields=id,title`, publisher.rawKey);
      async function feed(directory: string) {
        const response = await request(
          `${path}?directoryId=${directory}&fields=id,title`,
          publisher.rawKey,
        );
        expect(response.status).toBe(200);
        return listSchema
          .parse(await response.json())
          .data.items.filter((e) => e.id === id);
      }
      async function visible(title: string, directory: string | null) {
        const response = await detail();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          data: { entry: { id, title } },
        });
        expect(await feed(folder)).toEqual(
          directory === folder ? [{ id, title }] : [],
        );
        expect(await feed(emptyFolder)).toEqual(
          directory === emptyFolder ? [{ id, title }] : [],
        );
      }
      async function absent() {
        const response = await detail();
        expect(response.status).toBe(404);
        expect(errorSchema.parse(await response.json()).error.code).toBe(
          "ENTRY_NOT_FOUND",
        );
        expect(await feed(folder)).toEqual([]);
        expect(await feed(emptyFolder)).toEqual([]);
      }
      await absent();
      expect(
        (await write("matrix-status", { entryId: id, status: "published" }))
          .status,
      ).toBe(200);
      await visible("Matrix A", folder);
      expect(
        (
          await write("matrix-update", {
            entryId: id,
            title: "Matrix B",
            directoryId: emptyFolder,
          })
        ).status,
      ).toBe(200);
      await visible("Matrix A", folder);
      expect((await write("matrix-publish", { entryId: id })).status).toBe(200);
      await visible("Matrix B", emptyFolder);
      const before =
        await sql`select published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`;
      const unsafe = {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "image-block",
              version: 1,
              src: "https://public.invalid/image?access_token=synthetic-credential",
            },
          ],
        },
      };
      expect(
        (
          await write("matrix-update", {
            entryId: id,
            title: "Invalid draft",
            body: unsafe,
          })
        ).status,
      ).toBe(200);
      const denied = await write("matrix-publish", { entryId: id });
      expect(denied.status).toBe(400);
      expect(errorSchema.parse(await denied.json()).error.code).toBe(
        "PUBLICATION_INVALID",
      );
      expect(
        JSON.stringify(
          await sql`select published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`,
        ),
      ).toBe(JSON.stringify(before));
      await visible("Matrix B", emptyFolder);
      // An older install can contain an oversized saved draft. Prepare only
      // that draft in the owned DB; the published snapshot must stay unchanged.
      const oversized = {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [
                { type: "text", version: 1, text: "界".repeat(400_000) },
              ],
            },
          ],
        },
      };
      await sql`update cms.content_entries set data=jsonb_set(data,'{body}',${sql.json(oversized)}::jsonb),updated_at=now() where id=${id} and workspace_id=${workspaceId}`;
      const tooLarge = await write("matrix-publish", { entryId: id });
      expect(tooLarge.status).toBe(400);
      expect(errorSchema.parse(await tooLarge.json()).error.code).toBe(
        "PUBLICATION_TOO_LARGE",
      );
      expect(
        JSON.stringify(
          await sql`select published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`,
        ),
      ).toBe(JSON.stringify(before));
      await visible("Matrix B", emptyFolder);
      expect(
        (
          await write("matrix-update", {
            entryId: id,
            title: "Matrix C",
            directoryId: null,
            body: { root: { type: "root", version: 1, children: [] } },
          })
        ).status,
      ).toBe(200);
      await visible("Matrix B", emptyFolder);
      expect((await write("matrix-publish", { entryId: id })).status).toBe(200);
      await visible("Matrix C", null);
      const correlatedBody = (title: string) => ({
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: title }],
            },
          ],
        },
      });
      expect(
        (
          await write("matrix-update", {
            entryId: id,
            title: "Matrix concurrent D",
            directoryId: folder,
            body: correlatedBody("Matrix concurrent D"),
          })
        ).status,
      ).toBe(200);
      const raced = await Promise.all([
        write("matrix-update", {
          entryId: id,
          title: "Matrix concurrent E",
          body: correlatedBody("Matrix concurrent E"),
        }),
        write("matrix-publish", { entryId: id }),
      ]);
      expect(raced.map((r) => r.status)).toEqual([200, 200]);
      const [snapshot] =
        await sql`select published_snapshot from cms.content_entries where id=${id}`;
      const committed = z
        .object({
          published_snapshot: z.object({
            entry: z.object({
              title: z.enum(["Matrix concurrent D", "Matrix concurrent E"]),
              body: z.object({
                root: z.object({
                  children: z.array(
                    z.object({
                      children: z.array(z.object({ text: z.string() })),
                    }),
                  ),
                }),
              }),
            }),
          }),
        })
        .parse(snapshot);
      expect(
        committed.published_snapshot.entry.body.root.children[0]?.children[0]
          ?.text,
      ).toBe(committed.published_snapshot.entry.title);
      await visible(committed.published_snapshot.entry.title, folder);
      expect(
        (await write("matrix-status", { entryId: id, status: "archived" }))
          .status,
      ).toBe(200);
      await absent();
      expect(
        (await write("matrix-status", { entryId: id, status: "published" }))
          .status,
      ).toBe(200);
      await visible("Matrix concurrent E", folder);
      const stable =
        await sql`select status,published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`;
      expect((await write("matrix-delete", { entryId: id })).status).toBe(403);
      expect(
        JSON.stringify(
          await sql`select status,published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`,
        ),
      ).toBe(JSON.stringify(stable));
      expect(
        (await write("matrix-status", { entryId: id, status: "draft" })).status,
      ).toBe(200);
      await absent();
      expect(
        (
          await write("matrix-update", {
            entryId: id,
            title: "Matrix due",
            directoryId: folder,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await write("matrix-status", {
            entryId: id,
            status: "scheduled",
            publishAt: new Date(Date.now() + 60000).toISOString(),
          })
        ).status,
      ).toBe(200);
      await absent();
      const scheduler = createScheduledEntryPublisher();
      await scheduler.runNow();
      await absent();
      // Move only this disposable fixture's due timestamp forward in test time;
      // preserve draft/snapshot metadata and run the real lock/validator/writer.
      await sql`update cms.content_entries set published_at=now()-interval '1 second' where id=${id} and workspace_id=${workspaceId} and status='scheduled'`;
      await Promise.all([scheduler.runNow(), scheduler.runNow()]);
      await visible("Matrix due", folder);
      const once =
        await sql`select published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`;
      await scheduler.runNow();
      expect(
        JSON.stringify(
          await sql`select published_snapshot,published_at,published_snapshot_digest from cms.content_entries where id=${id}`,
        ),
      ).toBe(JSON.stringify(once));
      expect(
        (await write("matrix-status", { entryId: id, status: "archived" }))
          .status,
      ).toBe(200);
      await absent();
      scheduler.stop();
    });
    it("publishes each legacy flag through the signed gateway and withdraws metadata publication", async () => {
      const legacy = issuedSchema.parse(
        await issue(
          {
            name: "Synthetic legacy capability fixture",
            presetKey: "cms_publisher",
          },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      for (const action of [
        "cms.content.create",
        "cms.blog_entry.create",
        "cms.blog_entry.updateMeta",
      ])
        await sql`insert into platform.workspace_api_key_scopes(api_key_id,action_key) values(${legacy.id},${action}) on conflict do nothing`;
      const [type] =
        await sql`select id from cms.content_types where workspace_id=${workspaceId} and template_key='blog_post'`;
      if (!type) throw new Error("Synthetic blog type unavailable");
      async function effect(index: number, payload: unknown) {
        if (!gateway) throw new Error("Gateway not started");
        return fetch(
          new URL(
            `/workspaces/${workspaceId}/fixture/effect-${index}`,
            gateway.url,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-XS-API-Key": legacy.rawKey,
            },
            body: JSON.stringify(payload),
          },
        );
      }
      for (const index of [0, 1]) {
        for (const trigger of ["top", "nested", "timestamp"] as const) {
          const title = `Legacy published ${index} ${trigger}`;
          const data = {
            slug: crypto.randomUUID(),
            title,
            ...(trigger === "nested" ? { publishNow: true } : {}),
            ...(trigger === "timestamp"
              ? { publishedAt: "2026-01-01T00:00:00Z" }
              : {}),
          };
          const response = await effect(index, {
            contentTypeId: String(type.id),
            data,
            ...(trigger === "top" ? { publishNow: true } : {}),
          });
          expect(response.status).toBe(200);
          const created = z
            .object({
              data: z.object({
                data: z.object({ entry: z.object({ id: z.string().uuid() }) }),
              }),
            })
            .parse(await response.json());
          const id = created.data.data.entry.id;
          const detail = await request(
            `${path}/${id}?fields=title`,
            legacy.rawKey,
          );
          expect(detail.status).toBe(200);
          expect(await detail.json()).toMatchObject({
            data: { entry: { title } },
          });
          const [persisted] =
            await sql`select status,published_snapshot,published_snapshot_digest from cms.content_entries where id=${id} and workspace_id=${workspaceId}`;
          const publication = z
            .object({
              status: z.literal("published"),
              published_snapshot: z.object({
                entry: z.object({ title: z.string() }),
              }),
              published_snapshot_digest: z.string().regex(/^v1:[0-9a-f]{64}$/),
            })
            .parse(persisted);
          expect(publication.published_snapshot.entry.title).toBe(title);
          expect(
            (await effect(2, { id, data: { title: "Saved legacy draft" } }))
              .status,
          ).toBe(200);
          expect(
            await (
              await request(`${path}/${id}?fields=title`, legacy.rawKey)
            ).json(),
          ).toMatchObject({ data: { entry: { title } } });
          expect((await effect(2, { id, publishNow: true })).status).toBe(200);
          expect(
            await (
              await request(`${path}/${id}?fields=title`, legacy.rawKey)
            ).json(),
          ).toMatchObject({ data: { entry: { title: "Saved legacy draft" } } });
          expect((await effect(2, { id, unpublish: true })).status).toBe(200);
          expect(
            (await request(`${path}/${id}?fields=title`, legacy.rawKey)).status,
          ).toBe(404);
        }
      }
    });
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
    it("requires explicit replacement of an old key while new Authoring inherits reads", async () => {
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
      ).toBe(200);
      expect(
        await sql`select action_key from platform.workspace_api_key_scopes where api_key_id=${old.id} order by action_key`,
      ).toHaveLength(4);
    });
    it("keeps older six-scope Publisher delivery denied until explicit replacement", async () => {
      const legacy = issuedSchema.parse(
        await issue(
          { name: "Older Publisher fixture", presetKey: "cms_publisher" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      const retained = [
        "cms.entry.create",
        "cms.entry.update",
        "cms.entry.getById",
        "cms.entry.listByDirectory",
        "cms.entry.publish",
        "cms.entry.status.set",
      ];
      await sql`delete from platform.workspace_api_key_scopes where api_key_id=${legacy.id} and action_key not in ${sql(retained)}`;
      const stored = async () =>
        (
          await sql`select action_key from platform.workspace_api_key_scopes where api_key_id=${legacy.id} order by action_key`
        ).map((row) => row.action_key);
      expect(await stored()).toEqual([...retained].sort());
      expect(
        (await request(`${path}?directoryId=${folder}`, legacy.rawKey)).status,
      ).toBe(403);
      expect((await request(`${path}/${entryId}`, legacy.rawKey)).status).toBe(
        403,
      );
      const replacement = issuedSchema.parse(
        await issue(
          { name: "Replacement Publisher fixture", presetKey: "cms_publisher" },
          { workspaceId, userId, requestId: crypto.randomUUID() },
        ),
      );
      expect(replacement.scopes).toHaveLength(12);
      expect(
        (await request(`${path}?directoryId=${folder}`, replacement.rawKey))
          .status,
      ).toBe(200);
      expect(
        (await request(`${path}/${entryId}`, replacement.rawKey)).status,
      ).toBe(200);
      expect(await stored()).toEqual([...retained].sort());
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
