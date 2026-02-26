import { afterAll, beforeEach, describe, expect, mock, test, vi } from "bun:test";

type SelectResult = unknown[];

function createThenableChain<T extends unknown[]>(result: T) {
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: (onFulfilled: (value: T) => unknown, onRejected?: (err: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return chain as {
    from: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    offset: ReturnType<typeof vi.fn>;
    then: (
      onFulfilled: (value: T) => unknown,
      onRejected?: (err: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

function createDbStub() {
  let selectResults: SelectResult[] = [];
  let insertReturningResults: unknown[][] = [];
  let updateReturningResults: unknown[][] = [];
  let deleteWhereResults: unknown[][] = [];

  const stub: any = {
    __lastSelectChain: null as null | ReturnType<typeof createThenableChain>,
    __lastInsertValues: null as null | unknown,
    __lastUpdateSet: null as null | unknown,
    __setSelectResults(results: SelectResult[]) {
      selectResults = [...results];
    },
    __setInsertReturningResults(results: unknown[][]) {
      insertReturningResults = [...results];
    },
    __setUpdateReturningResults(results: unknown[][]) {
      updateReturningResults = [...results];
    },
    __setDeleteWhereResults(results: unknown[][]) {
      deleteWhereResults = [...results];
    },
    __reset() {
      selectResults = [];
      insertReturningResults = [];
      updateReturningResults = [];
      deleteWhereResults = [];
      stub.__lastSelectChain = null;
      stub.__lastInsertValues = null;
      stub.__lastUpdateSet = null;
      vi.clearAllMocks();
    },
    select: vi.fn((_shape?: unknown) => {
      const result = (selectResults.shift() ?? []) as unknown[];
      const chain = createThenableChain(result);
      stub.__lastSelectChain = chain;
      return chain;
    }),
    insert: vi.fn((_table: unknown) => {
      const returningResult = insertReturningResults.shift() ?? [];
      const chain: any = {
        values: vi.fn((values: unknown) => {
          stub.__lastInsertValues = values;
          return chain;
        }),
        returning: vi.fn(async () => returningResult),
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (err: unknown) => unknown,
        ) => Promise.resolve(returningResult).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    update: vi.fn((_table: unknown) => {
      const returningResult = updateReturningResults.shift() ?? [];
      const chain: any = {
        set: vi.fn((set: unknown) => {
          stub.__lastUpdateSet = set;
          return chain;
        }),
        where: vi.fn(() => chain),
        returning: vi.fn(async () => returningResult),
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (err: unknown) => unknown,
        ) => Promise.resolve(returningResult).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    delete: vi.fn((_table: unknown) => {
      const whereResult = deleteWhereResults.shift() ?? [];
      const chain: any = {
        where: vi.fn(() => chain),
        returning: vi.fn(async () => whereResult),
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (err: unknown) => unknown,
        ) => Promise.resolve(whereResult).then(onFulfilled, onRejected),
      };
      return chain;
    }),
  };

  return stub;
}

const dbStub = createDbStub();

mock.module("../../../../src/infra/db/index", () => ({ db: dbStub }));

const commentRepo = await import(
  "../../../../src/infra/db/repositories/comment.repository"
);
const contentEntryRepo = await import(
  "../../../../src/infra/db/repositories/content-entry.repository"
);
const contentTypeRepo = await import(
  "../../../../src/infra/db/repositories/content-type.repository"
);
const globalTemplateRepo = await import(
  "../../../../src/infra/db/repositories/global-content-template.repository"
);
const seeders = await import("../../../../src/infra/db/seeders");

beforeEach(() => {
  dbStub.__reset();
});

afterAll(() => {
  mock.restore();
});

describe("DB repositories (unit)", () => {
  test("comment.repository executes queries and maps return shapes", async () => {
    dbStub.__setSelectResults([[{ id: "c1" }], []]);
    dbStub.__setInsertReturningResults([[{ id: "c2" }]]);

    const found = await commentRepo.findCommentByIdAndEntry("c1", "e1", "ws1");
    expect(found).toBeTruthy();
    expect(dbStub.__lastSelectChain?.limit).toHaveBeenCalledWith(1);

    const missing = await commentRepo.findCommentByIdAndEntry(
      "missing",
      "e1",
      "ws1",
    );
    expect(missing).toBeNull();

    const created = await commentRepo.createComment({
      workspaceId: "ws1",
      entryId: "e1",
      content: "hello",
    });
    expect(created).toBeTruthy();
    expect((dbStub.__lastInsertValues as any)?.status).toBe("pending");
  });

  test("comment.repository listCommentsForEntry applies pagination chain", async () => {
    dbStub.__setSelectResults([[{ id: "c1" }]]);

    const res = await commentRepo.listCommentsForEntry({
      workspaceId: "ws1",
      entryId: "e1",
      statusFilter: "all",
      limit: 10,
      offset: 5,
    });

    expect(res).toHaveLength(1);
    expect(dbStub.__lastSelectChain?.limit).toHaveBeenCalledWith(10);
    expect(dbStub.__lastSelectChain?.offset).toHaveBeenCalledWith(5);
  });

  test("content-entry.repository exported functions are callable without a real DB", async () => {
    dbStub.__setSelectResults([
      [{ id: "e1" }], // findEntryByIdAndWorkspace
      [{ id: "bySlug" }], // findEntryBySlug
      [{ id: "list1" }, { id: "list2" }], // listEntriesByContentType
      [{ id: "pubBySlug" }], // findPublishedEntryBySlug
      [{ id: "pubList" }], // listPublishedEntries
      [{ id: "adminList" }], // listAdminEntries
    ]);
    dbStub.__setInsertReturningResults([[{ id: "created" }]]);
    dbStub.__setUpdateReturningResults([[{ id: "updated" }]]);

    expect(
      await contentEntryRepo.findEntryByIdAndWorkspace("e1", "ws1"),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.createEntry({
        workspaceId: "ws1",
        contentTypeId: "ct1",
        data: { slug: "s", title: "t" },
      }),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.updateEntryByIdAndWorkspace({
        entryId: "e1",
        workspaceId: "ws1",
        contentTypeId: "ct1",
        status: "published",
      }),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.findEntryBySlug("ws1", "ct1", "hello"),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.listEntriesByContentType("ws1", "ct1"),
    ).toHaveLength(2);

    expect(
      await contentEntryRepo.findPublishedEntryBySlug("ws1", "ct1", "hello"),
    ).toBeTruthy();

    await contentEntryRepo.listPublishedEntries("ws1", "ct1", 10, 0, "tag");
    expect(dbStub.__lastSelectChain?.orderBy).toHaveBeenCalled();

    await contentEntryRepo.listAdminEntries({
      workspaceId: "ws1",
      contentTypeId: "ct1",
      limit: 1000, // should clamp to 100
      offset: -5, // should clamp to 0
      search: "a%b",
    });
    expect(dbStub.__lastSelectChain?.limit).toHaveBeenCalledWith(100);
    expect(dbStub.__lastSelectChain?.offset).toHaveBeenCalledWith(0);
  });

  test("content-entry.repository directory/collaborator/favorite helpers are callable without a real DB", async () => {
    dbStub.__setUpdateReturningResults([
      [{ id: "scoped-update" }],
      [{ id: "soft-deleted" }],
      [{ id: "published" }],
    ]);
    dbStub.__setSelectResults([
      [{ id: "dir-1" }], // listEntriesByDirectory
      [{ entryId: "e1", userId: "u1", displayName: "User 1" }], // listEntryCollaboratorsByEntryIds
      [{ id: "fav-1" }], // toggleEntryFavorite (remove existing)
      [], // toggleEntryFavorite (add new)
      [{ entryId: "e2" }], // listFavoriteEntryIdsByUser
      [{ entry: { id: "e3" } }], // listFavoritedEntriesByUser
    ]);
    dbStub.__setInsertReturningResults([
      [{ userId: "u1", displayName: "User 1" }], // replaceEntryCollaborators
    ]);
    dbStub.__setDeleteWhereResults([
      [], // replaceEntryCollaborators
      [], // toggleEntryFavorite existing delete
    ]);

    expect(
      await contentEntryRepo.updateEntryByIdAndWorkspaceScoped({
        entryId: "e1",
        workspaceId: "ws1",
        data: { title: "Updated" } as any,
      }),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.softDeleteEntryByIdAndWorkspace({
        entryId: "e1",
        workspaceId: "ws1",
        deletedBy: "user1",
      }),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.publishEntryByIdAndWorkspace({
        entryId: "e1",
        workspaceId: "ws1",
      }),
    ).toBeTruthy();

    expect(
      await contentEntryRepo.listEntriesByDirectory({
        workspaceId: "ws1",
        directoryId: "dir-1",
        sortBy: "title",
        sortDirection: "asc",
        limit: 25,
        offset: 2,
      }),
    ).toHaveLength(1);
    expect(dbStub.__lastSelectChain?.limit).toHaveBeenCalledWith(25);
    expect(dbStub.__lastSelectChain?.offset).toHaveBeenCalledWith(2);

    const collaboratorMap = await contentEntryRepo.listEntryCollaboratorsByEntryIds({
      workspaceId: "ws1",
      entryIds: ["e1"],
    });
    expect(collaboratorMap.get("e1")?.[0]?.displayName).toBe("User 1");

    const replaced = await contentEntryRepo.replaceEntryCollaborators({
      workspaceId: "ws1",
      entryId: "e1",
      collaborators: [{ userId: "u1", displayName: "User 1" }],
    });
    expect(replaced).toHaveLength(1);

    const removedFavorite = await contentEntryRepo.toggleEntryFavorite({
      workspaceId: "ws1",
      entryId: "e1",
      userId: "u1",
    });
    expect(removedFavorite.isFavorite).toBe(false);

    const addedFavorite = await contentEntryRepo.toggleEntryFavorite({
      workspaceId: "ws1",
      entryId: "e1",
      userId: "u1",
    });
    expect(addedFavorite.isFavorite).toBe(true);

    const favoriteIds = await contentEntryRepo.listFavoriteEntryIdsByUser({
      workspaceId: "ws1",
      userId: "u1",
    });
    expect(favoriteIds.has("e2")).toBe(true);

    const favoriteEntries = await contentEntryRepo.listFavoritedEntriesByUser({
      workspaceId: "ws1",
      userId: "u1",
      limit: 10,
      offset: 0,
    });
    expect(favoriteEntries).toHaveLength(1);
  });

  test("content-type.repository exported functions are callable without a real DB", async () => {
    dbStub.__setSelectResults([
      [{ id: "ct1", name: "CT" }], // findContentTypeByIdAndWorkspace
      [{ id: "ct2", name: "CT" }], // findContentTypeByTemplateKey
      [{ id: "ct3", name: "CT" }], // findContentTypeByRouteSegmentAndWorkspace
      [
        {
          id: "ct4",
          workspaceId: "ws1",
          templateKey: "blog_post",
          name: "Blog",
          slug: "blog-post",
          routeSegment: "blog",
          config: {},
          templateId: "tpl1",
          templateDescription: "Standard blog post template",
          templateFieldsSchema: { a: 1 },
        },
      ], // findContentTypeWithTemplateByIdAndWorkspace
      [
        {
          id: "ct5",
          name: "A",
          slug: "a",
          routeSegment: "a",
          templateKey: "t1",
        },
      ], // listContentTypesForWorkspace
      [
        {
          contentTypeId: "ct6",
          name: "A",
          slug: "a",
          routeSegment: "a",
          templateKey: "t1",
          templateId: null,
          templateDescription: null,
          templateFieldsSchema: null,
        },
        {
          contentTypeId: "ct7",
          name: "B",
          slug: "b",
          routeSegment: "b",
          templateKey: "t2",
          templateId: "tpl2",
          templateDescription: "Template 2",
          templateFieldsSchema: { b: 2 },
        },
      ], // listContentTypesForWorkspaceWithTemplates
    ]);

    expect(
      await contentTypeRepo.findContentTypeByIdAndWorkspace("ct1", "ws1"),
    ).toBeTruthy();

    expect(
      await contentTypeRepo.findContentTypeByTemplateKey("blog_post", "ws1"),
    ).toBeTruthy();

    expect(
      await contentTypeRepo.findContentTypeByRouteSegmentAndWorkspace("blog", "ws1"),
    ).toBeTruthy();

    const withTemplate =
      await contentTypeRepo.findContentTypeWithTemplateByIdAndWorkspace(
        "ct4",
        "ws1",
      );
    expect(withTemplate?.templateId).toBe("tpl1");
    expect(withTemplate?.template?.fieldsSchema).toEqual({ a: 1 });

    expect(
      await contentTypeRepo.listContentTypesForWorkspace("ws1"),
    ).toHaveLength(1);

    const withTemplates =
      await contentTypeRepo.listContentTypesForWorkspaceWithTemplates("ws1");
    expect(withTemplates).toHaveLength(2);
    expect(withTemplates[0]?.template).toBeNull();
    expect(withTemplates[1]?.template?.id).toBe("tpl2");
  });

  test("global-content-template.repository listGlobalContentTemplates is callable without a real DB", async () => {
    dbStub.__setSelectResults([[{ id: "tpl1", key: "k1" }]]);

    const templates = await globalTemplateRepo.listGlobalContentTemplates();
    expect(templates).toHaveLength(1);
    expect(dbStub.__lastSelectChain?.orderBy).toHaveBeenCalled();
  });

  test("seeders are idempotent and cover both branches", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    // seedBlogPostTemplate: create
    dbStub.__setSelectResults([[]]);
    await seeders.seedBlogPostTemplate(dbStub);
    expect(dbStub.insert).toHaveBeenCalled();

    // seedBlogPostTemplate: update
    dbStub.__reset();
    dbStub.__setSelectResults([[{ id: "tpl1" }]]);
    await seeders.seedBlogPostTemplate(dbStub);
    expect(dbStub.update).toHaveBeenCalled();

    // seedBlogPostContentType: create
    dbStub.__reset();
    dbStub.__setSelectResults([[]]);
    await seeders.seedBlogPostContentType(dbStub, "ws1");
    expect(dbStub.insert).toHaveBeenCalled();

    // seedBlogPostContentType: skip
    dbStub.__reset();
    dbStub.__setSelectResults([[{ id: "ct1" }]]);
    await seeders.seedBlogPostContentType(dbStub, "ws1");
    expect(dbStub.insert).not.toHaveBeenCalled();

    // runSeed delegates
    dbStub.__reset();
    dbStub.__setSelectResults([[], []]);
    await seeders.runSeed(dbStub, "ws1");
    expect(dbStub.insert).toHaveBeenCalled();

    log.mockRestore();
  });
});
