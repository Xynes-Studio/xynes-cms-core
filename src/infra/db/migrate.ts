import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config";

const runMigrations = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Use `bun run db:migrate` (loads .env.dev) or export DATABASE_URL.",
    );
  }

  // Disable prefetch as it is not supported for "Transaction" pool mode which is often used in Supabase
  // But here we are connecting directly? The URL is port 5432.
  // SSH tunnel usually maps 5432 to remote 5432.
  // If it's transaction pooler, prepare: false is needed.
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations completed!");

  await sql.end();
};

runMigrations().catch((err) => {
  console.error("Migration failed!", err);
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    err.code === "ECONNREFUSED"
  ) {
    console.error(
      "DB connection refused. Ensure Postgres is running and DATABASE_URL points to the correct host/port (see xynes-infra/infra/SSH_TUNNEL_SUPABASE_DB.md).",
    );
  }
  process.exit(1);
});
