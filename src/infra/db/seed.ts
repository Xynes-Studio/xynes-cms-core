import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import { runSeed } from "./seeders";

const seed = async () => {
    if (!config.databaseUrl) {
        throw new Error("DATABASE_URL is not set");
    }

    if (!config.defaultWorkspaceId) {
        throw new Error("DEFAULT_WORKSPACE_ID is not set");
    }

    const sql = postgres(config.databaseUrl, { max: 1 });
    const db = drizzle(sql);

    console.log("Seeding database...");

    try {
        await runSeed(db, config.defaultWorkspaceId);
        console.log("Seeding completed successfully!");
    } catch (e) {
        console.error("Seeding failed:", e);
        process.exit(1);
    } finally {
        await sql.end();
    }
};

seed();
