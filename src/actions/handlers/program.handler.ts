import { z } from "zod";
import type { ActionContext } from "../types";
import {
  type CreateEntryForTemplateDeps,
  createEntryForTemplate,
} from "./_shared/content-entry-create";
import { IsoDateTimeStringSchema } from "./_shared/schemas";

export const ProgramEntryDataSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    excerpt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    startDate: IsoDateTimeStringSchema.optional(),
    endDate: IsoDateTimeStringSchema.optional(),
    location: z.string().optional(),
  })
  .strict();

export const ProgramCreatePayloadSchema = z
  .object({
    contentTypeId: z.string().uuid(),
    documentId: z.string().uuid().nullable().optional(),
    publishNow: z.boolean().optional(),
    data: ProgramEntryDataSchema,
  })
  .strict();

export type ProgramCreatePayload = z.infer<typeof ProgramCreatePayloadSchema>;

export function makeProgramCreateHandler(deps?: CreateEntryForTemplateDeps) {
  return async (payload: ProgramCreatePayload, ctx: ActionContext) => {
    const entry = await createEntryForTemplate(payload, ctx, "program", deps);
    return { entry };
  };
}

export const handleProgramCreate = makeProgramCreateHandler();
