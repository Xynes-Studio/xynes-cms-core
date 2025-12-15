import { describe, expect, it } from "bun:test";
import { parseFieldsSchema } from "../../src/infra/content-templates";

describe("FieldsSchema validator", () => {
  it("should accept structured scalar fields", () => {
    const parsed = parseFieldsSchema({
      title: { type: "string", required: true },
      slug: { type: "string" },
    });

    expect(parsed.title).toEqual({ type: "string", required: true });
    expect(parsed.slug).toEqual({ type: "string", required: false });
  });

  it("should accept structured array fields with items", () => {
    const parsed = parseFieldsSchema({
      tags: { type: "array", items: { type: "string" } },
    });

    expect(parsed.tags).toEqual({
      type: "array",
      required: false,
      items: { type: "string" },
    });
  });

  it("should reject legacy string shorthand", () => {
    expect(() => parseFieldsSchema({ title: "string" })).toThrow();
  });

  it("should reject array fields without items", () => {
    expect(() => parseFieldsSchema({ tags: { type: "array" } })).toThrow();
  });
});
