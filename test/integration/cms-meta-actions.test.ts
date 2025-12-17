import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/index";
import { db } from "../../src/infra/db";
import { contentTypes, globalContentTemplates } from "../../src/infra/db/schema";
import {
  BLOG_POST_CONTENT_TYPE_SLUG,
  BLOG_POST_TEMPLATE_KEY,
  BLOG_POST_TYPE_ROUTE_SEGMENT,
  runSeed,
} from "../../src/infra/db/seeders";
import { INTERNAL_SERVICE_TOKEN } from "../support/internal-auth";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "true")(
  "CMS meta actions integration",
  () => {
  const testWorkspaceId = crypto.randomUUID();

  beforeAll(async () => {
    await runSeed(db, testWorkspaceId);
  });

  afterAll(async () => {
    await db.delete(contentTypes).where(eq(contentTypes.workspaceId, testWorkspaceId));
  });

  it("cms.templates.listGlobal returns the seeded blog_post template", async () => {
    const [templateRow] = await db
      .select()
      .from(globalContentTemplates)
      .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

    expect(templateRow).toBeDefined();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.templates.listGlobal",
        payload: {},
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    expect(response.ok).toBe(true);

    const templates = response.data as Array<any>;
    const returned = templates.find((t) => t.key === BLOG_POST_TEMPLATE_KEY);
    expect(returned).toBeDefined();
    expect(returned.id).toBe(templateRow.id);
    expect(returned.fieldsSchema).toEqual(templateRow.fieldsSchema);
    expect(returned.name).toBe(templateRow.description ?? templateRow.key);
  });

  it("cms.content_types.listForWorkspace returns the seeded blog content type for the workspace", async () => {
    const [ctRow] = await db
      .select()
      .from(contentTypes)
      .where(
        and(
          eq(contentTypes.workspaceId, testWorkspaceId),
          eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG),
        ),
      );

    expect(ctRow).toBeDefined();

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.content_types.listForWorkspace",
        payload: {},
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    expect(response.ok).toBe(true);

    const contentTypesList = response.data as Array<any>;
    const returned = contentTypesList.find((t) => t.id === ctRow.id);
    expect(returned).toBeDefined();
    expect(returned.name).toBe(ctRow.name);
    expect(returned.slug).toBe(ctRow.slug);
    expect(returned.routeSegment).toBe(BLOG_POST_TYPE_ROUTE_SEGMENT);
    expect(returned.templateKey).toBe(ctRow.templateKey);
    expect(returned.template).toBeUndefined();
  });

  it("cms.content_types.listForWorkspace includeTemplates=true includes template schema", async () => {
    const [templateRow] = await db
      .select()
      .from(globalContentTemplates)
      .where(eq(globalContentTemplates.key, BLOG_POST_TEMPLATE_KEY));

    const [ctRow] = await db
      .select()
      .from(contentTypes)
      .where(
        and(
          eq(contentTypes.workspaceId, testWorkspaceId),
          eq(contentTypes.slug, BLOG_POST_CONTENT_TYPE_SLUG),
        ),
      );

    const res = await app.request("/internal/cms-actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Token": INTERNAL_SERVICE_TOKEN,
        "X-Workspace-Id": testWorkspaceId,
      },
      body: JSON.stringify({
        actionKey: "cms.content_types.listForWorkspace",
        payload: { includeTemplates: true },
      }),
    });

    expect(res.status).toBe(200);
    const response = (await res.json()) as any;
    expect(response.ok).toBe(true);

    const contentTypesList = response.data as Array<any>;
    const returned = contentTypesList.find((t) => t.id === ctRow.id);
    expect(returned).toBeDefined();
    expect(returned.templateKey).toBe(BLOG_POST_TEMPLATE_KEY);
    expect(returned.routeSegment).toBe(BLOG_POST_TYPE_ROUTE_SEGMENT);
    expect(returned.templateId).toBe(templateRow.id);
    expect(returned.template).toEqual({
      id: templateRow.id,
      key: BLOG_POST_TEMPLATE_KEY,
      name: templateRow.description ?? BLOG_POST_TEMPLATE_KEY,
      fieldsSchema: templateRow.fieldsSchema,
    });
  });
  },
);
