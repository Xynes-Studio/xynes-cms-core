import { Hono } from "hono";
import { config } from "../infra/config";
import { checkPostgresReadiness } from "../infra/readiness";

export type ReadyRouteDependencies = {
  getDatabaseUrl?: () => string;
  check?: typeof checkPostgresReadiness;
  schemaName?: string;
};

export function createReadyRoute({
  getDatabaseUrl = () => process.env.DATABASE_URL ?? config.databaseUrl,
  check = checkPostgresReadiness,
  schemaName = "cms",
}: ReadyRouteDependencies = {}) {
  const readyRoute = new Hono();

  readyRoute.get("/", async (c) => {
    try {
      const databaseUrl = getDatabaseUrl();
      await check({ databaseUrl, schemaName });
      return c.json({ status: "ready" }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ status: "not_ready", error: message }, 503);
    }
  });

  return readyRoute;
}

export default createReadyRoute();
