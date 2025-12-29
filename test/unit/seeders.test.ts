/**
 * Unit tests for CMS seeders
 * CMS-TEMPLATE-CORE-1: Template-Driven Content Types
 */

import { describe, expect, it } from "bun:test";
import {
  BLOG_POST_FIELDS_SCHEMA,
  BLOG_POST_TEMPLATE_KEY,
  BLOG_POST_CONTENT_TYPE_SLUG,
  BLOG_POST_TYPE_ROUTE_SEGMENT,
  PROGRAM_FIELDS_SCHEMA,
  PROGRAM_TEMPLATE_KEY,
  PROGRAM_CONTENT_TYPE_SLUG,
  PROGRAM_TYPE_ROUTE_SEGMENT,
  EVENT_FIELDS_SCHEMA,
  EVENT_TEMPLATE_KEY,
  EVENT_CONTENT_TYPE_SLUG,
  EVENT_TYPE_ROUTE_SEGMENT,
  DEFAULT_TEMPLATE_DEFINITIONS,
  DEFAULT_CONTENT_TYPE_DEFINITIONS,
} from "../../src/infra/db/seeders";

describe("CMS Template Definitions", () => {
  describe("Blog Post Template", () => {
    it("should have correct template key", () => {
      expect(BLOG_POST_TEMPLATE_KEY).toBe("blog_post");
    });

    it("should have correct content type slug", () => {
      expect(BLOG_POST_CONTENT_TYPE_SLUG).toBe("blog-post");
    });

    it("should have correct route segment", () => {
      expect(BLOG_POST_TYPE_ROUTE_SEGMENT).toBe("blog");
    });

    it("should define required fields in schema", () => {
      expect(BLOG_POST_FIELDS_SCHEMA.slug.required).toBe(true);
      expect(BLOG_POST_FIELDS_SCHEMA.title.required).toBe(true);
    });

    it("should define optional fields in schema", () => {
      expect(BLOG_POST_FIELDS_SCHEMA.excerpt.required).toBe(false);
      expect(BLOG_POST_FIELDS_SCHEMA.tags.required).toBe(false);
      expect(BLOG_POST_FIELDS_SCHEMA.coverImageUrl.required).toBe(false);
    });
  });

  describe("Program Template", () => {
    it("should have correct template key", () => {
      expect(PROGRAM_TEMPLATE_KEY).toBe("program");
    });

    it("should have correct content type slug", () => {
      expect(PROGRAM_CONTENT_TYPE_SLUG).toBe("program");
    });

    it("should have correct route segment", () => {
      expect(PROGRAM_TYPE_ROUTE_SEGMENT).toBe("programs");
    });

    it("should define required fields in schema", () => {
      expect(PROGRAM_FIELDS_SCHEMA.slug.required).toBe(true);
      expect(PROGRAM_FIELDS_SCHEMA.title.required).toBe(true);
    });

    it("should define program-specific fields", () => {
      expect(PROGRAM_FIELDS_SCHEMA.duration).toBeDefined();
      expect(PROGRAM_FIELDS_SCHEMA.level).toBeDefined();
      expect(PROGRAM_FIELDS_SCHEMA.category).toBeDefined();
    });
  });

  describe("Event Template", () => {
    it("should have correct template key", () => {
      expect(EVENT_TEMPLATE_KEY).toBe("event");
    });

    it("should have correct content type slug", () => {
      expect(EVENT_CONTENT_TYPE_SLUG).toBe("event");
    });

    it("should have correct route segment", () => {
      expect(EVENT_TYPE_ROUTE_SEGMENT).toBe("events");
    });

    it("should define required fields in schema", () => {
      expect(EVENT_FIELDS_SCHEMA.slug.required).toBe(true);
      expect(EVENT_FIELDS_SCHEMA.title.required).toBe(true);
    });

    it("should define event-specific fields", () => {
      expect(EVENT_FIELDS_SCHEMA.startDate).toBeDefined();
      expect(EVENT_FIELDS_SCHEMA.endDate).toBeDefined();
      expect(EVENT_FIELDS_SCHEMA.location).toBeDefined();
      expect(EVENT_FIELDS_SCHEMA.venue).toBeDefined();
    });
  });

  describe("DEFAULT_TEMPLATE_DEFINITIONS", () => {
    it("should include all three template types", () => {
      const keys = DEFAULT_TEMPLATE_DEFINITIONS.map((t) => t.key);
      expect(keys).toContain("blog_post");
      expect(keys).toContain("program");
      expect(keys).toContain("event");
    });

    it("should have unique keys", () => {
      const keys = DEFAULT_TEMPLATE_DEFINITIONS.map((t) => t.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("should have descriptions for all templates", () => {
      for (const template of DEFAULT_TEMPLATE_DEFINITIONS) {
        expect(template.description).toBeTruthy();
      }
    });
  });

  describe("DEFAULT_CONTENT_TYPE_DEFINITIONS", () => {
    it("should include all three content types", () => {
      const keys = DEFAULT_CONTENT_TYPE_DEFINITIONS.map((ct) => ct.templateKey);
      expect(keys).toContain("blog_post");
      expect(keys).toContain("program");
      expect(keys).toContain("event");
    });

    it("should have unique route segments", () => {
      const segments = DEFAULT_CONTENT_TYPE_DEFINITIONS.map(
        (ct) => ct.routeSegment,
      );
      const uniqueSegments = new Set(segments);
      expect(uniqueSegments.size).toBe(segments.length);
    });

    it("should have unique slugs", () => {
      const slugs = DEFAULT_CONTENT_TYPE_DEFINITIONS.map((ct) => ct.slug);
      const uniqueSlugs = new Set(slugs);
      expect(uniqueSlugs.size).toBe(slugs.length);
    });

    it("should have display names for all content types", () => {
      for (const ct of DEFAULT_CONTENT_TYPE_DEFINITIONS) {
        expect(ct.name).toBeTruthy();
      }
    });
  });
});
