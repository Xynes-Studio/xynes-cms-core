import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import { runSeed } from "./seeders";

const seed = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Use `bun run db:seed` (loads .env.dev) or export DATABASE_URL.",
    );
  }

  const defaultWorkspaceId =
    process.env.DEFAULT_WORKSPACE_ID ?? config.defaultWorkspaceId;
  if (!defaultWorkspaceId) {
    throw new Error(
      "DEFAULT_WORKSPACE_ID is not set. Use `bun run db:seed` with DEFAULT_WORKSPACE_ID in your env file.",
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  console.log("Seeding database...");

  try {
    await runSeed(db, defaultWorkspaceId);
    console.log("Seeding completed successfully!");
  } catch (e) {
    console.error("Seeding failed:", e);
    process.exit(1);
  } finally {
    await sql.end();
  }
};

seed();
