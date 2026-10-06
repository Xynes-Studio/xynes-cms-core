import postgres from "postgres";
import { z } from "zod";
import { loadInternalRequestSigner } from "../src/infra/security/internal-request";
import {
  createPublicationSmokeClient,
  runPublicationSmoke,
} from "./lib/publication-smoke";

if (process.argv.includes("--help")) {
  console.log(`CMS publication smoke (local/staging fixtures only)

SMOKE_ALLOW_WRITES=true WORKSPACE_ID=<uuid> XS_USER_ID=<workspace-owner-uuid> \\
XYNES_ENV_FILE=../xynes-infra/.env.localhost bun run smoke:publication

Requires DATABASE_URL and the gateway-owned INTERNAL_REQUEST_PRIVATE_KEY_FILE / INTERNAL_REQUEST_KEY_ID in the selected env file.
CMS_CORE_URL defaults to http://localhost:4202. Uses one uniquely named entry,
soft-deleted even on failure. Reads stored snapshots; never resets or migrates DB.
This smoke checks stored snapshots and authoring actions; delivery has separate regressions.`);
  process.exit(0);
}

let sql: ReturnType<typeof postgres> | undefined;
try {
  if (process.env.SMOKE_ALLOW_WRITES !== "true")
    throw new Error(
      "Set SMOKE_ALLOW_WRITES=true to allow creation and cleanup of the smoke fixture",
    );
  const env = z
    .object({
      DATABASE_URL: z.string().url(),
      WORKSPACE_ID: z.string().uuid(),
      XS_USER_ID: z.string().uuid(),
      CMS_CORE_URL: z.string().url().default("http://localhost:4202"),
    })
    .safeParse(process.env);
  if (!env.success)
    throw new Error(
      "Set valid DATABASE_URL, gateway signing identity, WORKSPACE_ID and XS_USER_ID (values omitted)",
    );
  const settings = env.data;
  const signer = loadInternalRequestSigner("gateway");
  sql = postgres(settings.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    connection: { statement_timeout: 10_000 },
  });
  const client = sql;
  await runPublicationSmoke({
    preflight: async () => {
      try {
        await client`SELECT published_snapshot, scheduled_publication_failure FROM cms.content_entries LIMIT 0`;
      } catch (error) {
        const missingColumns = z
          .object({ code: z.literal("42703") })
          .safeParse(error).success;
        throw new Error(
          missingColumns
            ? "CMS migration 0008 is required; back up and apply it before running API smoke"
            : "CMS database preflight failed (database details omitted)",
        );
      }
    },
    action: createPublicationSmokeClient({
      url: settings.CMS_CORE_URL,
      signer,
      workspaceId: settings.WORKSPACE_ID,
      userId: settings.XS_USER_ID,
      timeoutMs: 10_000,
    }),
    inspect: async (entryId) => {
      const rows =
        await client`SELECT published_snapshot FROM cms.content_entries WHERE id = ${entryId} AND workspace_id = ${settings.WORKSPACE_ID}`;
      return rows[0]?.published_snapshot;
    },
    report: (label) => console.log(`PASS ${label}`),
  });
  console.log("CMS publication API smoke passed");
} catch (error) {
  // CLI assertions are safe; postgres/request exceptions can contain credentials.
  console.error(
    error instanceof Error &&
      (error.message.startsWith("CMS ") ||
        error.message.startsWith("Set ") ||
        error.message.startsWith("cms.entry.") ||
        error.message.startsWith("Smoke assertion"))
      ? error.message
      : "CMS publication smoke failed (details omitted)",
  );
  process.exitCode = 1;
} finally {
  await sql?.end({ timeout: 5 });
}
