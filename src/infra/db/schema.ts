import { pgSchema } from "drizzle-orm/pg-core";

export const cmsSchema = pgSchema("cms");

// Add tables here later, e.g.:
// export const posts = cmsSchema.table("posts", { ... });
