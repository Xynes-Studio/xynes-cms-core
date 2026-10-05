import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

// Fail after the fixture sets its server URL, before any database query, then
// observe teardown from the same child process. This covers partial setup too.
for (const original of ["https://caller.invalid", "", undefined]) {
  it(`restores CMS_CORE_URL after partial fixture setup (${String(original)})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cms-a4-env-cleanup-"));
    try {
      const observation = join(directory, "environment.json");
      const preload = join(directory, "observe.test.ts");
      await writeFile(
        preload,
        `import { writeFileSync } from "node:fs";
import { afterAll } from "bun:test";
const fixture = process.env.A4_FIXTURE_MODULE;
if (!fixture) throw new Error("Missing fixture module");
await import(fixture);
afterAll(() => {
  const path = process.env.A4_ENV_OBSERVATION_FILE;
  if (!path) throw new Error("Missing fixture observation path");
  writeFileSync(path, JSON.stringify({ present: Object.hasOwn(process.env, "CMS_CORE_URL"), value: process.env.CMS_CORE_URL }));
});`,
      );
      const environment = {
        ...process.env,
        NODE_ENV: "test",
        RUN_CMS_DELIVERY_ACCESS_TESTS: "true",
        DATABASE_URL: "postgres://fixture@127.0.0.1:1/cms_int_a4_guard",
        XYNES_GATEWAY_REPO: join(directory, "missing-gateway"),
        XYNES_ACCOUNTS_REPO: join(directory, "missing-accounts"),
        XYNES_INFRA_REPO: join(directory, "missing-infra"),
        A4_ENV_OBSERVATION_FILE: observation,
        A4_FIXTURE_MODULE: pathToFileURL(
          join(
            process.cwd(),
            "test/integration/content-delivery-access.test.ts",
          ),
        ).href,
        CMS_CORE_URL: original,
      };
      if (original === undefined) delete environment.CMS_CORE_URL;
      const child = Bun.spawn({
        cmd: [process.execPath, "test", preload],
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).not.toBe(0);
      expect(stdout + stderr).toContain("error: Could not resolve:");
      expect(JSON.parse(await readFile(observation, "utf8"))).toEqual(
        original === undefined
          ? { present: false }
          : { present: true, value: original },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
