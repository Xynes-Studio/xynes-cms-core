import type { Config } from "drizzle-kit";

export default {
    schema: "./src/infra/db/schema.ts",
    out: "./drizzle",
    driver: "pg",
    dbCredentials: {
        connectionString: process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/db",
    },
} satisfies Config;
