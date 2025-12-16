import { z } from "zod";
import {
  listContentTypesForWorkspace,
  listContentTypesForWorkspaceWithTemplates,
} from "../../infra/db/repositories/content-type.repository";
import type { ActionContext } from "../types";
import type { GlobalTemplateDTO } from "./templates-list-global.handler";

export const ContentTypesListForWorkspacePayloadSchema = z
  .object({
    includeTemplates: z.boolean().optional().default(false),
  })
  .strict();

export type ContentTypesListForWorkspacePayload = z.infer<
  typeof ContentTypesListForWorkspacePayloadSchema
>;

export interface WorkspaceContentTypeDTO {
  id: string;
  name: string;
  slug: string;
  templateKey: string;
  templateId?: string | null;
  template?: GlobalTemplateDTO | null;
}

export interface ContentTypesListForWorkspaceDeps {
  listContentTypesForWorkspace: typeof listContentTypesForWorkspace;
  listContentTypesForWorkspaceWithTemplates: typeof listContentTypesForWorkspaceWithTemplates;
}

export function createHandleContentTypesListForWorkspace(
  deps: ContentTypesListForWorkspaceDeps,
) {
  return async function handleContentTypesListForWorkspace(
    payload: ContentTypesListForWorkspacePayload,
    ctx: ActionContext,
  ): Promise<WorkspaceContentTypeDTO[]> {
    const { workspaceId } = ctx;

    if (payload.includeTemplates) {
      const rows =
        await deps.listContentTypesForWorkspaceWithTemplates(workspaceId);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        templateKey: row.templateKey,
        templateId: row.templateId,
        template: row.template,
      }));
    }

    const rows = await deps.listContentTypesForWorkspace(workspaceId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      templateKey: row.templateKey,
    }));
  };
}

export const handleContentTypesListForWorkspace =
  createHandleContentTypesListForWorkspace({
    listContentTypesForWorkspace,
    listContentTypesForWorkspaceWithTemplates,
  });
