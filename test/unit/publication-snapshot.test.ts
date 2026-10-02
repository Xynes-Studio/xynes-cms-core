import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  buildPublicationSnapshot,
  getDeliveryState,
  type Json,
  PUBLICATION_MAX_BYTES,
  PublicationError,
  PublicationSummarySchema,
  readPublicationSnapshot,
} from "../../src/actions/publication-snapshot";

const id = "11111111-1111-4111-8111-111111111111";
const at = new Date("2026-10-01T00:00:00.000Z");
const paragraph = (text = "Hello") => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});
const body = () => ({
  root: { type: "root", version: 1, children: [paragraph()] },
});
const draft = (data: Record<string, unknown> = {}) => ({
  id,
  directoryId: null,
  data: {
    title: "A",
    description: "Summary",
    tags: ["tag"],
    body: body(),
    ...data,
  },
});

describe("publication snapshot", () => {
  it("accepts representative Lumia rich text, tables, panels and public media within the byte budget", () => {
    const children = [
      {
        type: "heading",
        version: 1,
        tag: "h2",
        children: [
          {
            type: "text",
            version: 1,
            text: "Heading",
            format: 1,
            mode: "normal",
            detail: 0,
            style: "",
          },
        ],
      },
      {
        type: "list",
        version: 1,
        listType: "bullet",
        tag: "ul",
        start: 1,
        children: [
          { type: "listitem", version: 1, value: 1, children: [paragraph()] },
        ],
      },
      {
        type: "table",
        version: 1,
        children: [
          {
            type: "tablerow",
            version: 1,
            children: [
              {
                type: "tablecell",
                version: 1,
                colSpan: 1,
                rowSpan: 1,
                headerState: 0,
                children: [paragraph()],
              },
            ],
          },
        ],
      },
      {
        type: "panel-block",
        version: 1,
        variant: "info",
        title: "Info",
        children: [paragraph()],
      },
      { type: "status", version: 1, color: "success", text: "Ready" },
      {
        type: "image-block",
        version: 1,
        src: "https://public.invalid/image.png",
        alt: "External image",
      },
      {
        type: "video-block",
        version: 1,
        src: "https://www.youtube.com/watch?v=fixture",
        provider: "youtube",
      },
      {
        type: "file-block",
        version: 1,
        url: "https://public.invalid/manual.pdf",
        filename: "manual.pdf",
      },
      {
        type: "link",
        version: 1,
        url: "https://public.invalid/page",
        children: [{ type: "text", version: 1, text: "Link" }],
      },
    ];
    const snapshot = buildPublicationSnapshot(
      draft({
        body: {
          root: {
            type: "root",
            version: 1,
            children: [
              ...children,
              ...Array.from({ length: 500 }, () =>
                paragraph("Harmless article paragraph. ".repeat(10)),
              ),
            ],
          },
        },
      }),
      at,
    );
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(
      PUBLICATION_MAX_BYTES,
    );
    expect(readPublicationSnapshot(snapshot)).toEqual(snapshot);
  });
  it("accepts the actual supported editor serialization for links, tables and code", () => {
    const serialized: unknown = JSON.parse(
      readFileSync("test/fixtures/cms-delivery/lexical-0.38.2.json", "utf8"),
    );
    const snapshot = buildPublicationSnapshot(draft({ body: serialized }), at);
    expect(serialized).toEqual(snapshot.entry.body);
    expect(readPublicationSnapshot(snapshot)).toEqual(snapshot);
  });
  it("copies only public fields without retaining mutable draft references", () => {
    const input = draft({
      ownerName: "private",
      createdBy: id,
      rawKey: "private",
      popularityScore: 7,
    });
    const snapshot = buildPublicationSnapshot(input, at);
    expect(Object.keys(snapshot.entry)).toEqual([
      "id",
      "title",
      "description",
      "tags",
      "publishedAt",
      "body",
    ]);
    expect(snapshot.entry).toMatchObject({
      id,
      title: "A",
      description: "Summary",
      tags: ["tag"],
      publishedAt: at.toISOString(),
    });
    input.data.tags = ["changed"];
    expect(snapshot.entry.tags).toEqual(["tag"]);
    expect(snapshot.entry.body).not.toBe(input.data.body);
  });
  it("pins real summary validation bounds to A1's reviewed artifact", () => {
    const bytes = readFileSync("test/fixtures/cms-delivery/contract.v1.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      readFileSync(
        "test/fixtures/cms-delivery/contract.v1.sha256",
        "utf8",
      ).trim(),
    );
    const contract = z
      .object({
        snapshotMaxBytes: z.number(),
        summaryBounds: z.object({
          title: z.object({ max: z.number() }),
          descriptionMaxLength: z.number(),
          tags: z.object({ maxItems: z.number(), maxLength: z.number() }),
        }),
      })
      .parse(JSON.parse(bytes.toString()));
    const b = contract.summaryBounds;
    const summary = {
      id,
      title: "T".repeat(b.title.max),
      description: "D".repeat(b.descriptionMaxLength),
      tags: Array.from({ length: b.tags.maxItems }, () =>
        "x".repeat(b.tags.maxLength),
      ),
      publishedAt: at.toISOString(),
    };
    expect(PublicationSummarySchema.safeParse(summary).success).toBe(true);
    for (const patch of [
      { title: "" },
      { title: summary.title + "x" },
      { description: summary.description + "x" },
      { tags: [...summary.tags, "x"] },
      { tags: ["x".repeat(b.tags.maxLength + 1)] },
      { tags: [""] },
    ]) {
      expect(
        PublicationSummarySchema.safeParse({ ...summary, ...patch }).success,
      ).toBe(false);
    }
    expect(contract.snapshotMaxBytes).toBe(PUBLICATION_MAX_BYTES);
    const escapedSummary = PublicationSummarySchema.parse({
      ...summary,
      title: "\u0001".repeat(b.title.max),
      description: "\u0001".repeat(b.descriptionMaxLength),
      tags: Array.from({ length: b.tags.maxItems }, () =>
        "\u0001".repeat(b.tags.maxLength),
      ),
    });
    expect(
      Buffer.byteLength(JSON.stringify(Array(100).fill(escapedSummary))),
    ).toBeLessThan(6 * 1024 * 1024);
    // Maximum summary page remains bounded independently of body size.
    expect(
      Buffer.byteLength(JSON.stringify(Array(100).fill(summary))),
    ).toBeLessThan(3 * 1024 * 1024);
  });
  it("supports absent bodies and legacy JSON-string data without exposing arbitrary fields", () => {
    expect(
      buildPublicationSnapshot(
        {
          id,
          directoryId: null,
          data: JSON.stringify({
            title: "Legacy",
            excerpt: "Description",
            audit: "private",
          }),
        },
        at,
      ).entry,
    ).toMatchObject({
      title: "Legacy",
      description: "Description",
      tags: [],
      body: null,
    });
    for (const data of [
      "bad json",
      [],
      null,
      { title: 5 },
      { title: "A", tags: "bad" },
      { title: "A", body: { secret: "private" } },
    ]) {
      expect(() =>
        buildPublicationSnapshot({ id, directoryId: null, data }, at),
      ).toThrow(PublicationError);
    }
  });
  it("retains storage object references, removes transient image URLs/status and rejects private node fields", () => {
    const image = {
      type: "image-block",
      version: 1,
      objectId: id,
      src: "https://storage.invalid/o?X-Amz-Signature=private",
      alt: "Image",
      status: "uploaded",
    };
    const document = { root: { type: "root", version: 1, children: [image] } };
    const snapshot = buildPublicationSnapshot(draft({ body: document }), at);
    expect(snapshot.entry.body).toEqual({
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "image-block",
            version: 1,
            objectId: id,
            src: "",
            alt: "Image",
          },
        ],
      },
    });
    expect(document.root.children[0].src).toContain("private");
    for (const node of [
      { ...image, objectId: "invalid" },
      { ...image, status: "uploading" },
      { ...image, rawKey: "private" },
      { ...image, url: image.src },
      { type: "image-block", version: 1, src: image.src },
      { type: "link", version: 1, url: "javascript:alert(1)", children: [] },
      { type: "file-block", version: 1, url: "blob:preview", filename: "file" },
    ]) {
      expect(() =>
        buildPublicationSnapshot(
          draft({
            body: { root: { type: "root", version: 1, children: [node] } },
          }),
          at,
        ),
      ).toThrow(PublicationError);
    }
  });
  it("rejects credential query keys across external media and links on publication and snapshot reads", () => {
    const valid = buildPublicationSnapshot(draft(), at);
    const nodes = (url: string): { [key: string]: Json }[] => [
      { type: "image-block", version: 1, src: url },
      { type: "video-block", version: 1, src: url, provider: "html5" },
      { type: "file-block", version: 1, url, filename: "fixture.pdf" },
      { type: "link", version: 1, url, children: [] },
      { type: "autolink", version: 1, url, children: [], isUnlinked: false },
    ];
    for (const key of [
      "access_token",
      "auth_token",
      "api_key",
      "ACCESS_TOKEN",
      "accessToken",
      "authToken",
      "apiKey",
      "access-token",
      "auth-token",
      "api-key",
      "client_secret",
      "clientSecret",
      "public_api_key",
      "password",
      "credential",
      "authorization",
      "jwt",
      "key",
      // URLSearchParams decodes keys before the safety check.
      "access%5Ftoken",
      "%61pi%5Fkey",
    ]) {
      const url = `https://public.invalid/fixture?${key}=synthetic-credential`;
      for (const node of nodes(url)) {
        const unsafeBody = {
          root: { type: "root", version: 1, children: [node] },
        };
        expect(() =>
          buildPublicationSnapshot(draft({ body: unsafeBody }), at),
        ).toThrow(PublicationError);
        const saved = { ...valid, entry: { ...valid.entry, body: unsafeBody } };
        expect(readPublicationSnapshot(saved)).toBeNull();
        expect(
          getDeliveryState(
            {
              id,
              status: "published",
              publishedAt: at,
              deletedAt: null,
              publishedSnapshot: saved,
            },
            at,
          ),
        ).toBe("republish_required");
      }
    }
    const ordinaryUrl =
      "https://public.invalid/fixture?v=video&t=30&width=640&height=480&lang=en&utm_source=cms";
    const ordinaryBody = {
      root: { type: "root", version: 1, children: nodes(ordinaryUrl) },
    };
    const snapshot = buildPublicationSnapshot(
      draft({ body: ordinaryBody }),
      at,
    );
    expect(snapshot.entry.body).toEqual(ordinaryBody);
    expect(readPublicationSnapshot(snapshot)).toEqual(snapshot);
  });
  it("rejects URL-bearing or escaped CSS in every formatting field on publication and read", () => {
    const signed = "https://storage.invalid/o?X-Amz-Signature=synthetic";
    for (const css of [
      `background-image:url(${signed})`,
      `background-image:u\\72l(${signed})`,
      `background-image:u/**/rl(${signed})`,
    ]) {
      for (const node of [
        { type: "paragraph", version: 1, textStyle: css, children: [] },
        { type: "text", version: 1, text: "Hello", style: css },
        { type: "tablecell", version: 1, backgroundColor: css, children: [] },
      ]) {
        const unsafeBody = {
          root: { type: "root", version: 1, children: [node] },
        };
        expect(() =>
          buildPublicationSnapshot(draft({ body: unsafeBody }), at),
        ).toThrow(PublicationError);
        const valid = buildPublicationSnapshot(draft(), at);
        expect(
          readPublicationSnapshot({
            ...valid,
            entry: { ...valid.entry, body: unsafeBody },
          }),
        ).toBeNull();
      }
    }
    const formatted = {
      root: {
        type: "root",
        version: 1,
        textStyle: "color: rgb(1, 2, 3); font-size: 16px",
        children: [
          {
            type: "text",
            version: 1,
            text: "Hello",
            style: "font-weight: bold; color: #abcdef",
          },
        ],
      },
    };
    expect(
      readPublicationSnapshot(
        buildPublicationSnapshot(draft({ body: formatted }), at),
      ),
    ).not.toBeNull();
  });
  it("rejects unknown nodes, non-JSON values, excessive depth and oversize bytes without truncating", () => {
    for (const node of [
      { type: "unknown", version: 1 },
      { type: "text", version: 1, text: Infinity },
      { type: "text", version: 1, text: "Hello", privateAudit: id },
      { type: "tablecell", version: 1, backgroundColor: 5, children: [] },
      {
        type: "tablecell",
        version: 1,
        verticalAlign: "url(unsafe)",
        children: [],
      },
      { type: "table", version: 1, frozenColumnCount: -1, children: [] },
      { type: "table", version: 1, frozenRowCount: Infinity, children: [] },
      { type: "table", version: 1, rowStriping: "private", children: [] },
      {
        type: "video-block",
        version: 1,
        src: "https://public.invalid/video",
        title: null,
      },
    ]) {
      expect(() =>
        buildPublicationSnapshot(
          draft({
            body: { root: { type: "root", version: 1, children: [node] } },
          }),
          at,
        ),
      ).toThrow(PublicationError);
    }
    let deep: unknown = paragraph();
    for (let depth = 0; depth < 70; depth++)
      deep = { type: "paragraph", version: 1, children: [deep] };
    expect(() =>
      buildPublicationSnapshot(
        draft({
          body: { root: { type: "root", version: 1, children: [deep] } },
        }),
        at,
      ),
    ).toThrow(PublicationError);
    try {
      buildPublicationSnapshot(
        draft({
          body: {
            root: {
              type: "root",
              version: 1,
              children: [paragraph("界".repeat(PUBLICATION_MAX_BYTES / 2))],
            },
          },
        }),
        at,
      );
      throw new Error("expected oversize rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicationError);
      expect(error).toHaveProperty("code", "PUBLICATION_TOO_LARGE");
      expect(String(error)).not.toContain("界");
    }
  });
  it("uses one validator for snapshot reads and authoring availability, never current-data fallback", () => {
    const snapshot = buildPublicationSnapshot(draft(), at);
    const live = {
      id,
      status: "published",
      publishedAt: at,
      deletedAt: null,
      publishedSnapshot: snapshot,
    };
    expect(getDeliveryState(live, at)).toBe("available");
    expect(readPublicationSnapshot(snapshot)).toEqual(snapshot);
    for (const publishedSnapshot of [
      null,
      {},
      { ...snapshot, version: 2 },
      { ...snapshot, extra: "private" },
      { ...snapshot, entry: { ...snapshot.entry, createdBy: id } },
    ]) {
      expect(getDeliveryState({ ...live, publishedSnapshot }, at)).toBe(
        "republish_required",
      );
      expect(readPublicationSnapshot(publishedSnapshot)).toBeNull();
    }
    expect(
      getDeliveryState(
        {
          ...live,
          publishedSnapshot: {
            ...snapshot,
            entry: { ...snapshot.entry, id: crypto.randomUUID() },
          },
        },
        at,
      ),
    ).toBe("republish_required");
    for (const patch of [
      { status: "draft" },
      { status: "scheduled" },
      { status: "archived" },
      { deletedAt: at },
      { publishedAt: new Date(at.getTime() + 1) },
      { publishedAt: null },
    ])
      expect(getDeliveryState({ ...live, ...patch }, at)).toBe("unpublished");
  });
});
