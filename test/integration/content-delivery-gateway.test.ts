import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { gatewayIdentity } from "../support/internal-request";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import { createEntry } from "../../src/infra/db/repositories/content-entry.repository";
import {
  contentDirectories,
  contentEntries,
  contentTypes,
} from "../../src/infra/db/schema";
import { runSeed } from "../../src/infra/db/seeders";

type Match = {
  route: {
    id: string;
    pathPattern: string;
    method: string;
    serviceKey: string;
    targetPath: string;
    workspaceScoped: boolean;
    actionKey: string;
    isPublic: boolean;
  };
  params: Record<string, string>;
};
type Proxy = (
  match: Match,
  request: Request,
  query: Record<string, string>,
) => Promise<Response>;
const proxySchema = z.object({
  proxyRequest: z.custom<Proxy>((value) => typeof value === "function"),
});
const listSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string().optional() })),
    page: z.object({
      limit: z.number(),
      offset: z.number(),
      hasMore: z.boolean(),
    }),
  }),
});
const gatewayRepo = process.env.XYNES_GATEWAY_REPO;
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true" || !gatewayRepo)(
  "real gateway delivery transport (isolated routes/database)",
  () => {
    const workspaceId = crypto.randomUUID();
    const folder = crypto.randomUUID();
    let contentTypeId: string;
    let temporary: string;
    let router: unknown;
    let proxy: Proxy;
    let publishedId: string;
    const originalCmsUrl = process.env.CMS_CORE_URL;
    const originalPrivateFile = process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE;
    const originalKeyId = process.env.INTERNAL_REQUEST_KEY_ID;
    let restoreFetch = () => {};
    beforeAll(async () => {
      temporary = await mkdtemp(join(tmpdir(), "cms-a3-gateway-"));
      const privateFile = join(temporary, "gateway-private.pem");
      await writeFile(
        privateFile,
        gatewayIdentity.privateKey.export({ type: "pkcs8", format: "pem" }),
        { mode: 0o600 },
      );
      process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE = privateFile;
      process.env.INTERNAL_REQUEST_KEY_ID = "g1";
      process.env.CMS_CORE_URL = "http://cms-delivery.fixture.invalid";
      if (!gatewayRepo) throw new Error("Gateway checkout required");
      const build = await Bun.build({
        entrypoints: [join(gatewayRepo, "src/router/dynamicRouter.ts")],
        target: "bun",
        outdir: temporary,
      });
      if (!build.success)
        throw new Error("Gateway transport fixture build failed");
      const module: unknown = await import(
        pathToFileURL(join(temporary, "dynamicRouter.js")).href
      );
      const namespace = z.object({ DynamicRouter: z.unknown() }).parse(module);
      if (typeof namespace.DynamicRouter !== "function")
        throw new Error("Gateway router constructor unavailable");
      router = Reflect.construct(namespace.DynamicRouter, [
        [],
        { check: async () => true },
      ]);
      proxy = proxySchema.parse(router).proxyRequest;
      const fetchSpy = spyOn(globalThis, "fetch");
      restoreFetch = () => fetchSpy.mockRestore();
      fetchSpy.mockImplementation(
        Object.assign(
          async (
            input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
          ) => {
            const forwarded =
              input instanceof Request
                ? new Request(input, init)
                : new Request(input.toString(), init);
            expect(new URL(forwarded.url).hostname).toBe(
              "cms-delivery.fixture.invalid",
            );
            return app.request("/internal/cms-actions", {
              method: "POST",
              headers: forwarded.headers,
              body: await forwarded.text(),
            });
          },
          { preconnect: () => {} },
        ),
      );
      await runSeed(db, workspaceId);
      const [type] = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      contentTypeId = type.id;
      await db.insert(contentDirectories).values({
        id: folder,
        workspaceId,
        name: "Transport",
        pathSegment: "transport",
      });
      const entry = await createEntry({
        workspaceId,
        contentTypeId,
        directoryId: folder,
        status: "published",
        data: {
          slug: "transport",
          title: "123",
          description: "true",
          tags: [],
        },
      });
      publishedId = entry.id;
    });
    afterAll(async () => {
      restoreFetch();
      if (originalPrivateFile === undefined)
        delete process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE;
      else process.env.INTERNAL_REQUEST_PRIVATE_KEY_FILE = originalPrivateFile;
      if (originalKeyId === undefined)
        delete process.env.INTERNAL_REQUEST_KEY_ID;
      else process.env.INTERNAL_REQUEST_KEY_ID = originalKeyId;
      if (originalCmsUrl === undefined) delete process.env.CMS_CORE_URL;
      else process.env.CMS_CORE_URL = originalCmsUrl;
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.workspaceId, workspaceId));
      await db
        .delete(contentDirectories)
        .where(eq(contentDirectories.workspaceId, workspaceId));
      await db
        .delete(contentTypes)
        .where(eq(contentTypes.workspaceId, workspaceId));
      if (temporary) await rm(temporary, { recursive: true, force: true });
    });
    async function request(
      actionKey: string,
      query: Record<string, string>,
      entryId?: string,
    ) {
      const route = {
        id: "cms-a3-fixture",
        pathPattern: entryId
          ? "/workspaces/:workspaceId/delivery/entries/:entryId"
          : "/workspaces/:workspaceId/delivery/entries",
        method: "GET",
        serviceKey: "cms-core",
        targetPath: "/internal/cms-actions",
        workspaceScoped: true,
        actionKey,
        isPublic: false,
      };
      const req = Object.assign(
        new Request("http://gateway.fixture.invalid/delivery", {
          headers: { "X-Workspace-Id": crypto.randomUUID() },
        }),
        {
          auth: {
            actor: {
              kind: "api_key",
              apiKeyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              keyPrefix: "1234abcd",
              workspaceId,
              scopes: [actionKey],
            },
          },
        },
      );
      return proxy.call(
        router,
        { route, params: { workspaceId, ...(entryId ? { entryId } : {}) } },
        req,
        query,
      );
    }
    it("parses numeric pagination and CSV projection through the actual gateway", async () => {
      const response = await request("cms.delivery.listByDirectory", {
        directoryId: folder,
        limit: "1",
        offset: "0",
        fields: "title",
        sortBy: "title",
        sortDirection: "asc",
      });
      expect(response.status).toBe(200);
      expect(listSchema.parse(await response.json()).data).toEqual({
        items: [{ id: publishedId, title: "123" }],
        page: { limit: 1, offset: 0, hasMore: false },
      });
      const detail = await request(
        "cms.delivery.getById",
        { fields: "id" },
        publishedId,
      );
      expect(detail.status).toBe(200);
      expect(
        z
          .object({
            data: z.object({
              entry: z.object({ id: z.literal(publishedId) }).strict(),
            }),
          })
          .safeParse(await detail.json()).success,
      ).toBe(true);
    });
    it("keeps numeric and boolean-looking searches as text", async () => {
      for (const search of ["123", "true"]) {
        const response = await request("cms.delivery.listByDirectory", {
          directoryId: folder,
          search,
        });
        expect(response.status).toBe(200);
        expect(
          listSchema
            .parse(await response.json())
            .data.items.map((item) => item.id),
        ).toEqual([publishedId]);
      }
    });
    it("rejects invalid numeric/CSV values after real query coercion", async () => {
      const invalidQueries: Record<string, string>[] = [
        { limit: "1.5" },
        { limit: "101" },
        { offset: "10001" },
        { fields: "body" },
        { preview: "true" },
      ];
      for (const query of invalidQueries) {
        expect(
          (
            await request("cms.delivery.listByDirectory", {
              directoryId: folder,
              ...query,
            })
          ).status,
        ).toBe(400);
      }
    });
  },
);
