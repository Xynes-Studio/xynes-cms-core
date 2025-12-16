import { z } from "zod";
import { listGlobalContentTemplates } from "../../infra/db/repositories/global-content-template.repository";
import type { ActionContext } from "../types";

export const TemplatesListGlobalPayloadSchema = z.object({}).strict();
export type TemplatesListGlobalPayload = z.infer<
  typeof TemplatesListGlobalPayloadSchema
>;

export interface GlobalTemplateDTO {
  id: string;
  key: string;
  name: string;
  fieldsSchema: unknown;
}

export interface TemplatesListGlobalDeps {
  listGlobalContentTemplates: typeof listGlobalContentTemplates;
}

export function createHandleTemplatesListGlobal(deps: TemplatesListGlobalDeps) {
  return async function handleTemplatesListGlobal(
    _payload: TemplatesListGlobalPayload,
    _ctx: ActionContext,
  ): Promise<GlobalTemplateDTO[]> {
    const templates = await deps.listGlobalContentTemplates();
    return templates.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.description ?? t.key,
      fieldsSchema: t.fieldsSchema,
    }));
  };
}

export const handleTemplatesListGlobal = createHandleTemplatesListGlobal({
  listGlobalContentTemplates,
});
