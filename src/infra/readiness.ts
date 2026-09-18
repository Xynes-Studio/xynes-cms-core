import postgres from "postgres";

export type ReadinessSql = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<readonly unknown[]>) & {
  end: (options: { timeout: number }) => Promise<void>;
};

export type ReadinessClientFactory = (
  databaseUrl: string,
  options: Record<string, unknown>,
) => ReadinessSql;

export interface PostgresReadinessCheckOptions {
  databaseUrl: string;
  schemaName?: string;
  createClient?: ReadinessClientFactory;
}

export async function checkPostgresReadiness({
  databaseUrl,
  schemaName,
  createClient,
}: PostgresReadinessCheckOptions): Promise<void> {
  const clientFactory =
    createClient ?? (postgres as unknown as ReadinessClientFactory);
  const sql = clientFactory(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });

  try {
    if (schemaName) {
      const rows =
        await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${schemaName}`;
      if (rows.length === 0) {
        throw new Error("Required database schema is unavailable");
      }
    } else {
      await sql`SELECT 1`;
    }
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
}
