import { z } from "zod";
import { DomainError } from "./errors";

// A1 v1, platform-contracts 141e32a. Bounds are guarded against the pinned artifact.
export const PUBLICATION_MAX_BYTES = 1_048_576;
export const PublicationSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000),
    tags: z.array(z.string().trim().min(1).max(80)).max(50),
    publishedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };
export interface PublicationSnapshot {
  version: 1;
  directoryId: string | null;
  entry: z.infer<typeof PublicationSummarySchema> & {
    body: { [key: string]: Json } | null;
  };
}
export class PublicationError extends DomainError {
  constructor(
    code:
      | "PUBLICATION_INVALID"
      | "PUBLICATION_TOO_LARGE" = "PUBLICATION_INVALID",
  ) {
    super(
      code === "PUBLICATION_TOO_LARGE"
        ? "Publication exceeds the 1 MiB budget"
        : "Content is not valid for publication",
      code,
      400,
    );
  }
}

const record = z.record(z.string(), z.unknown());
const scalarText = z.string().max(PUBLICATION_MAX_BYTES).optional();
const finite = z.number().finite().optional();
const nodeFields = z
  .object({
    type: z.enum([
      "root",
      "paragraph",
      "text",
      "tab",
      "linebreak",
      "heading",
      "quote",
      "list",
      "listitem",
      "link",
      "autolink",
      "code",
      "code-highlight",
      "horizontalrule",
      "table",
      "tablerow",
      "tablecell",
      "panel-block",
      "status",
      "image-block",
      "video-block",
      "file-block",
    ]),
    version: z.literal(1),
    direction: z.enum(["ltr", "rtl"]).nullable().optional(),
    format: z.union([z.string(), z.number().finite()]).optional(),
    indent: finite,
    text: scalarText,
    textFormat: z.union([z.string(), z.number().finite()]).optional(),
    textStyle: scalarText,
    style: scalarText,
    detail: finite,
    mode: z.enum(["normal", "token", "segmented"]).optional(),
    tag: scalarText,
    listType: z.enum(["number", "bullet", "check"]).optional(),
    start: finite,
    value: finite,
    checked: z.boolean().optional(),
    url: scalarText,
    rel: scalarText.nullable(),
    target: scalarText.nullable(),
    title: scalarText.nullable(),
    isUnlinked: z.boolean().optional(),
    language: scalarText,
    theme: scalarText,
    highlightType: scalarText,
    colWidths: z.array(z.number().finite()).max(100).optional(),
    frozenColumnCount: z.number().int().min(0).max(100).optional(),
    frozenRowCount: z.number().int().min(0).max(10_000).optional(),
    rowStriping: z.boolean().optional(),
    height: finite,
    width: finite,
    headerState: finite,
    colSpan: finite,
    rowSpan: finite,
    backgroundColor: scalarText.nullable(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    variant: z.enum(["info", "warning", "success", "note"]).optional(),
    icon: scalarText,
    color: z.enum(["success", "warning", "error", "info"]).optional(),
    src: scalarText,
    objectId: z.string().uuid().optional(),
    alt: scalarText,
    caption: scalarText,
    layout: z.enum(["inline", "breakout", "fullWidth"]).optional(),
    alignment: z.enum(["left", "center", "right"]).optional(),
    status: z.literal("uploaded").optional(),
    provider: z.enum(["youtube", "vimeo", "loom", "html5"]).optional(),
    filename: scalarText,
    size: finite,
    mime: scalarText,
  })
  .strict();

const elementFields = [
  "children",
  "direction",
  "format",
  "indent",
  "textFormat",
  "textStyle",
];
const textFields = ["text", "format", "style", "detail", "mode"];
const linkFields = [...elementFields, "url", "rel", "target", "title"];
const mediaFields = ["src", "width", "height", "layout", "alignment", "status"];
const fieldsByNode: Record<
  z.infer<typeof nodeFields>["type"],
  readonly string[]
> = {
  root: elementFields,
  paragraph: elementFields,
  text: textFields,
  tab: textFields,
  linebreak: [],
  heading: [...elementFields, "tag"],
  quote: elementFields,
  list: [...elementFields, "tag", "listType", "start"],
  listitem: [...elementFields, "value", "checked"],
  link: linkFields,
  autolink: [...linkFields, "isUnlinked"],
  code: [...elementFields, "language", "theme"],
  "code-highlight": [...textFields, "highlightType"],
  horizontalrule: [],
  table: [
    ...elementFields,
    "colWidths",
    "frozenColumnCount",
    "frozenRowCount",
    "rowStriping",
  ],
  tablerow: [...elementFields, "height"],
  tablecell: [
    ...elementFields,
    "headerState",
    "colSpan",
    "rowSpan",
    "width",
    "backgroundColor",
    "verticalAlign",
  ],
  "panel-block": [...elementFields, "variant", "title", "icon"],
  status: ["text", "color"],
  "image-block": [...mediaFields, "objectId", "alt", "caption"],
  "video-block": [...mediaFields, "provider", "title"],
  "file-block": ["url", "filename", "size", "mime", "status"],
};

function safeUrl(value: string, link: boolean) {
  try {
    const url = new URL(value);
    if (
      !(link ? ["http:", "https:", "mailto:"] : ["http:", "https:"]).includes(
        url.protocol,
      ) ||
      url.username ||
      url.password
    )
      return false;
    return (
      ![...url.searchParams.keys()].some(
        (key) =>
          /^(x-amz-|x-goog-)/i.test(key) ||
          /(?:token|apikey|secret|password|credentials?|authorization|signature)$|^(?:sig|expires|key|jwt|auth)$/i.test(
            key.replace(/[_-]/g, ""),
          ),
      ) && !/\/storage\/v1\/object\/(sign|authenticated)\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// Closed formatting grammar: no resources, escapes, comments or custom functions.
function safeFormatting(value: string, colorOnly = false): boolean {
  const safeValue = (part: string) =>
    /^[a-z0-9#.,% ()"'_-]+$/i.test(part) &&
    !/[a-z-]+\s*\(/i.test(
      part.replace(/\b(?:rgb|rgba|hsl|hsla)\s*\([^()]*\)/gi, ""),
    );
  if (!value.trim()) return true;
  if (colorOnly) return safeValue(value);
  return value.split(";").every((declaration) => {
    if (!declaration.trim()) return true;
    const match =
      /^\s*(color|background-color|font-size|font-family|font-weight|font-style|text-decoration(?:-color|-style)?|letter-spacing|vertical-align)\s*:\s*(.+?)\s*$/i.exec(
        declaration,
      );
    return match !== null && safeValue(match[2]);
  });
}

function editorBody(
  value: unknown,
  reading = false,
): { [key: string]: Json } | null {
  if (value === undefined || value === null) return null;
  const document = z.object({ root: z.unknown() }).strict().parse(value);
  let count = 0;
  function node(value: unknown, depth: number): { [key: string]: Json } {
    if (depth > 64 || ++count > 10_000) throw new PublicationError();
    const { children, ...fields } = record.parse(value);
    const parsed = nodeFields.parse(fields);
    const allowed = fieldsByNode[parsed.type];
    if (
      Object.keys(fields).some(
        (key) => key !== "type" && key !== "version" && !allowed.includes(key),
      ) ||
      (children !== undefined && !allowed.includes("children")) ||
      (depth > 0 && parsed.type === "root") ||
      (parsed.title === null && !["link", "autolink"].includes(parsed.type))
    )
      throw new PublicationError();
    if (
      (parsed.type === "text" ||
        parsed.type === "tab" ||
        parsed.type === "status") &&
      parsed.text === undefined
    )
      throw new PublicationError();
    if (parsed.type === "image-block" && parsed.objectId) {
      if (reading && (parsed.src !== "" || parsed.status !== undefined))
        throw new PublicationError();
      parsed.src = "";
    } else {
      for (const url of [parsed.src, parsed.url]) {
        if (
          url !== undefined &&
          !safeUrl(url, parsed.type === "link" || parsed.type === "autolink")
        )
          throw new PublicationError();
      }
      if (["image-block", "video-block"].includes(parsed.type) && !parsed.src)
        throw new PublicationError();
      if (parsed.type === "file-block" && (!parsed.url || !parsed.filename))
        throw new PublicationError();
      if (["link", "autolink"].includes(parsed.type) && !parsed.url)
        throw new PublicationError();
    }
    for (const value of [parsed.style, parsed.textStyle])
      if (value !== undefined && !safeFormatting(value))
        throw new PublicationError();
    if (
      parsed.backgroundColor != null &&
      !safeFormatting(parsed.backgroundColor, true)
    )
      throw new PublicationError();
    const out: { [key: string]: Json } = {};
    for (const [key, field] of Object.entries(parsed))
      if (field !== undefined && key !== "status") out[key] = field;
    if (children !== undefined)
      out.children = z
        .array(z.unknown())
        .parse(children)
        .map((child) => node(child, depth + 1));
    else if (
      [
        "root",
        "paragraph",
        "heading",
        "quote",
        "list",
        "listitem",
        "link",
        "autolink",
        "code",
        "table",
        "tablerow",
        "tablecell",
        "panel-block",
      ].includes(parsed.type)
    )
      throw new PublicationError();
    return out;
  }
  const root = node(document.root, 0);
  if (root.type !== "root") throw new PublicationError();
  return { root };
}

function bounded(snapshot: PublicationSnapshot) {
  if (
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") > PUBLICATION_MAX_BYTES
  )
    throw new PublicationError("PUBLICATION_TOO_LARGE");
  return snapshot;
}

export function buildPublicationSnapshot(
  draft: { id: string; directoryId: string | null; data: unknown },
  at: Date,
): PublicationSnapshot {
  try {
    const data = record.parse(
      typeof draft.data === "string" ? JSON.parse(draft.data) : draft.data,
    );
    const summary = PublicationSummarySchema.parse({
      id: draft.id,
      title: data.title,
      description: data.description ?? data.excerpt ?? "",
      tags: data.tags ?? [],
      publishedAt: at.toISOString(),
    });
    return bounded({
      version: 1,
      directoryId: z.string().uuid().nullable().parse(draft.directoryId),
      entry: { ...summary, body: editorBody(data.body) },
    });
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError();
  }
}

const snapshotSchema = z
  .object({
    version: z.literal(1),
    directoryId: z.string().uuid().nullable(),
    entry: PublicationSummarySchema.extend({ body: z.unknown() }),
  })
  .strict();

export function readPublicationSnapshot(
  value: unknown,
): PublicationSnapshot | null {
  try {
    const parsed = snapshotSchema.parse(value);
    if (parsed.entry.body === undefined) return null;
    return bounded({
      ...parsed,
      entry: { ...parsed.entry, body: editorBody(parsed.entry.body, true) },
    });
  } catch {
    return null;
  }
}

export function getDeliveryState(
  entry: {
    id: string;
    status: string;
    publishedAt: Date | null;
    deletedAt: Date | null;
    publishedSnapshot?: unknown;
  },
  now = new Date(),
): "available" | "unpublished" | "republish_required" {
  if (
    entry.status !== "published" ||
    entry.deletedAt ||
    !entry.publishedAt ||
    entry.publishedAt > now
  )
    return "unpublished";
  const snapshot = readPublicationSnapshot(entry.publishedSnapshot);
  return snapshot &&
    snapshot.entry.id === entry.id &&
    snapshot.entry.publishedAt === entry.publishedAt.toISOString()
    ? "available"
    : "republish_required";
}

/** Existing raw-entry response contracts must not expose new internal columns. */
export function legacyEntryDto<
  T extends {
    publishedSnapshot?: unknown;
    scheduledPublicationFailure?: unknown;
  },
>(entry: T) {
  const {
    publishedSnapshot: _snapshot,
    scheduledPublicationFailure: _failure,
    ...dto
  } = entry;
  return dto;
}
