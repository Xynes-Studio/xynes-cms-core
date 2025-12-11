import { z } from "zod";

export type CmsActionKey = 
  | 'cms.blog_entry.create'
  | 'cms.blog_entry.read'
  | 'cms.comments.create'
  | 'cms.comments.listForEntry'
  // For testing purposes, though in real app we might not include these in the union if they aren't real actions
  // But for now, we can extend this as needed.
  // To allow string for now (loose typing for dynamic nature if needed, but let's stick to strict union for safety)
  | string & {}; 

export interface ActionContext {
  workspaceId: string;
  userId?: string;
}

export type ActionHandler<T = any, R = any> = (payload: T, ctx: ActionContext) => Promise<R>;

export interface RegisteredAction {
  handler: ActionHandler;
  schema: z.ZodSchema<any>;
}
