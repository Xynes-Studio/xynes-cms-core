import { buildPublicationSnapshot } from "../../src/actions/publication-snapshot";
import type { ContentEntry } from "../../src/infra/db/repositories/content-entry.repository";

export const legacyFixtureId = "11111111-1111-4111-8111-111111111111";
export function legacyPublicationFixture(
  patch: Partial<ContentEntry> = {},
): ContentEntry {
  const at = new Date("2024-01-01T00:00:00.000Z");
  const data = {
    slug: "s",
    title: "Published",
    excerpt: "Published excerpt",
    tags: ["published"],
    coverImageUrl: "https://example.invalid/cover",
    body: { root: { type: "root", version: 1, children: [] } },
  };
  const draft = {
    id: legacyFixtureId,
    directoryId: null,
    documentId: null,
    data,
  };
  return {
    ...draft,
    workspaceId: "22222222-2222-4222-8222-222222222222",
    contentTypeId: "33333333-3333-4333-8333-333333333333",
    status: "published",
    publishedAt: at,
    publishedSnapshot: buildPublicationSnapshot(draft, at),
    publishedSnapshotValidated: true,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: at,
    updatedAt: at,
    ...patch,
  };
}
