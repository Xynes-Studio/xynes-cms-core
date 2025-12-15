export type FieldsSchema = Record<string, unknown>;

export type ContentTemplateDefinition = {
  key: string;
  description: string;
  fieldsSchema: FieldsSchema;
};

export type WorkspaceContentTypeDefinition = {
  templateKey: string;
  name: string;
  slug: string;
};

export const BLOG_POST_TEMPLATE: ContentTemplateDefinition = {
  key: "blog_post",
  description: "Standard blog post template",
  fieldsSchema: {
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    excerpt: { type: "string", required: false },
    tags: { type: "array", items: { type: "string" }, required: false },
    coverImageUrl: { type: "string", required: false },
    publishedAt: { type: "date", required: false },
  },
};

export const BLOG_POST_CONTENT_TYPE: WorkspaceContentTypeDefinition = {
  templateKey: BLOG_POST_TEMPLATE.key,
  name: "Blog Post",
  slug: "blog-post",
};

export const PROGRAM_TEMPLATE: ContentTemplateDefinition = {
  key: "program",
  description: "Standard program template",
  fieldsSchema: {
    title: { type: "string", required: true },
    slug: { type: "string", required: true },
    excerpt: { type: "string", required: false },
    tags: { type: "array", items: { type: "string" }, required: false },
    startDate: { type: "datetime", required: false },
    endDate: { type: "datetime", required: false },
    location: { type: "string", required: false },
  },
};

export const PROGRAM_CONTENT_TYPE: WorkspaceContentTypeDefinition = {
  templateKey: PROGRAM_TEMPLATE.key,
  name: "Program",
  slug: "program",
};

export const EVENT_TEMPLATE: ContentTemplateDefinition = {
  key: "event",
  description: "Standard event template",
  fieldsSchema: {
    title: { type: "string", required: true },
    slug: { type: "string", required: true },
    excerpt: { type: "string", required: false },
    tags: { type: "array", items: { type: "string" }, required: false },
    eventDate: { type: "datetime", required: false },
    location: { type: "string", required: false },
  },
};

export const EVENT_CONTENT_TYPE: WorkspaceContentTypeDefinition = {
  templateKey: EVENT_TEMPLATE.key,
  name: "Event",
  slug: "event",
};
