import { describe, expect, it } from "bun:test";
import { guardedPostgresEnvironment } from "../integration/libpq-env";

describe("direct delivery access fixture safeguards", () => {
  for (const url of [
    "postgres://fixture@127.0.0.1/cms_int_a4_fixture?database=postgres",
    "postgres://fixture@127.0.0.1/cms_int_a4_fixture#override",
    "https://127.0.0.1/cms_int_a4_fixture",
  ]) {
    it(`rejects unsafe database URL before resolving checkout paths: ${url}`, async () => {
      // Missing checkout paths prevent database access even if the URL guard regresses.
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          "test",
          "test/integration/content-delivery-access.test.ts",
        ],
        env: {
          ...process.env,
          NODE_ENV: "test",
          RUN_CMS_DELIVERY_ACCESS_TESTS: "true",
          DATABASE_URL: url,
          XYNES_GATEWAY_REPO: "",
          XYNES_ACCOUNTS_REPO: "",
          XYNES_INFRA_REPO: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).not.toBe(0);
      expect(stdout + stderr).toContain(
        "error: Requires an explicitly disposable cms_int_a4_* loopback database",
      );
      expect(stdout + stderr).not.toContain(
        "error: Explicit A4 checkout paths required",
      );
    });
  }
});

it("strips ambient libpq overrides from backup subprocesses", () => {
  const env = guardedPostgresEnvironment(
    new URL("postgres://fixture:password@127.0.0.1:54729/cms_int_a4_guard"),
    {
      PATH: "/bin",
      PGHOSTADDR: "192.0.2.123",
      PGSERVICE: "remote",
      PGSERVICEFILE: "/untrusted/service",
      PGOPTIONS: "-c search_path=hostile",
      PGDATABASE: "postgres",
    },
  );
  expect(env).toEqual({
    PATH: "/bin",
    PGHOST: "127.0.0.1",
    PGPORT: "54729",
    PGUSER: "fixture",
    PGPASSWORD: "password",
    PGDATABASE: "cms_int_a4_guard",
  });
});
