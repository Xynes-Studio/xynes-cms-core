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
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });

  try {
    if (schemaName) {
      await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${schemaName}`;
    } else {
      await sql`SELECT 1`;
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
