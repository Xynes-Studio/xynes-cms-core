import { z } from "zod";
import type { ActionContext } from "../types";
import {
  type CreateEntryForTemplateDeps,
  createEntryForTemplate,
} from "./_shared/content-entry-create";
import { IsoDateTimeStringSchema } from "./_shared/schemas";

/**
 * Schema for event entry data.
 */
export const EventEntryDataSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    excerpt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    eventDate: IsoDateTimeStringSchema.optional(),
    location: z.string().optional(),
  })
  .strict();

/**
 * Schema for `cms.event.create` payload.
 */
export const EventCreatePayloadSchema = z
  .object({
    contentTypeId: z.string().uuid(),
    documentId: z.string().uuid().nullable().optional(),
    publishNow: z.boolean().optional(),
    data: EventEntryDataSchema,
  })
  .strict();

export type EventCreatePayload = z.infer<typeof EventCreatePayloadSchema>;

/**
 * Factory for `cms.event.create` handler (dependency-injectable for unit tests).
 */
export function makeEventCreateHandler(deps?: CreateEntryForTemplateDeps) {
  return async (payload: EventCreatePayload, ctx: ActionContext) => {
    const entry = await createEntryForTemplate(payload, ctx, "event", deps);
    return { entry };
  };
}

/**
 * Handler for `cms.event.create`.
 */
export const handleEventCreate = makeEventCreateHandler();
