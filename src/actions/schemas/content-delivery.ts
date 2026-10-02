import { z } from "zod";
import type { PublicationSnapshot } from "../publication-snapshot";

// A1 v1, platform-contracts 141e32a; parity is checked against its pinned artifact.
export const DELIVERY_SUMMARY_FIELDS = [
  "id",
  "title",
  "description",
  "tags",
  "publishedAt",
] as const;
export const DELIVERY_DETAIL_FIELDS = [
  ...DELIVERY_SUMMARY_FIELDS,
  "body",
] as const;

function fieldSelector<Fields extends readonly ["id", ...string[]]>(
  fields: Fields,
) {
  return z
    .string()
    .max(128)
    .default(fields.join(","))
    .transform((raw, ctx) => {
      const parsed = z
        .array(z.enum(fields))
        .min(1)
        .max(fields.length)
        .refine((names) => new Set(names).size === names.length)
        .safeParse(raw.split(",").map((name) => name.trim()));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Invalid delivery fields" });
        return z.NEVER;
      }
      return [fields[0], ...parsed.data.filter((name) => name !== "id")];
    });
}

export const ContentDeliveryDirectoryPayloadSchema = z
  .object({
    directoryId: z.string().uuid(),
    sortBy: z.enum(["publishedAt", "title"]).default("publishedAt"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(10_000).default(0),
    search: z.string().trim().min(1).max(200).optional(),
    fields: fieldSelector(DELIVERY_SUMMARY_FIELDS),
  })
  .strict();
export const ContentDeliveryEntryPayloadSchema = z
  .object({
    entryId: z.string().uuid(),
    fields: fieldSelector(DELIVERY_DETAIL_FIELDS),
  })
  .strict();
export type ContentDeliveryDirectoryOptions = z.output<
  typeof ContentDeliveryDirectoryPayloadSchema
>;
export type ContentDeliveryEntryOptions = z.output<
  typeof ContentDeliveryEntryPayloadSchema
>;
export type DeliverySummary = Omit<PublicationSnapshot["entry"], "body">;
export type DeliveryListItem = Pick<DeliverySummary, "id"> &
  Partial<Omit<DeliverySummary, "id">>;
export type DeliveryEntry = DeliveryListItem &
  Partial<Pick<PublicationSnapshot["entry"], "body">>;
