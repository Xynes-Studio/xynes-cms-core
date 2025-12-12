import postgres from "postgres";

export interface PostgresReadinessCheckOptions {
  databaseUrl: string;
  schemaName?: string;
}

export async function checkPostgresReadiness({
  databaseUrl,
  schemaName,
}: PostgresReadinessCheckOptions): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 2,
    idle_timeout: 2,
    onnotice: () => {},
  });

  try {
    if (schemaName) {
      await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${schemaName}`;
    } else {
      await sql`SELECT 1`;
    }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

