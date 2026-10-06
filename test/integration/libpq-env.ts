export function guardedPostgresEnvironment(
  url: URL,
  environment: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    // Ambient hostaddr/service/options must not override the validated fixture URL.
    ...Object.fromEntries(
      Object.entries(environment).filter(([key]) => !key.startsWith("PG")),
    ),
    PGDATABASE: url.pathname.slice(1),
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}
