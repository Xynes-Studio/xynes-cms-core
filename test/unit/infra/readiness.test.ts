import { describe, expect, test } from "bun:test";
import { checkPostgresReadiness } from "../../../src/infra/readiness";

type SqlTag = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>) & {
  end: (opts: { timeout: number }) => Promise<void>;
};

function createStubClient({
  onQuery,
  onEnd,
  queryResult = [{}],
}: {
  onQuery?: (query: string, values: unknown[]) => void;
  onEnd?: (opts: { timeout: number }) => void;
  queryResult?: unknown[];
}): (databaseUrl: string, options: unknown) => SqlTag {
  return (_databaseUrl: string, _options: unknown) => {
    const sql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.join("?");
      onQuery?.(query, values);
      return queryResult;
    }) as SqlTag;

    sql.end = async (opts: { timeout: number }) => {
      onEnd?.(opts);
    };

    return sql;
  };
}

describe("checkPostgresReadiness (unit)", () => {
  test("queries pg_namespace when schemaName is provided", async () => {
    const seen = { query: null as string | null };
    let seenValues: unknown[] = [];
    let ended = false;

    await checkPostgresReadiness({
      databaseUrl: "postgres://example",
      schemaName: "cms",
      createClient: createStubClient({
        onQuery: (q, v) => {
          seen.query = q;
          seenValues = v;
        },
        onEnd: () => {
          ended = true;
        },
      }),
    });

    expect(seen.query).toContain("FROM pg_namespace");
    expect(seenValues).toEqual(["cms"]);
    expect(ended).toBe(true);
  });

  test("queries SELECT 1 when schemaName is missing", async () => {
    const seen = { query: null as string | null };
    let ended = false;

    await checkPostgresReadiness({
      databaseUrl: "postgres://example",
      createClient: createStubClient({
        onQuery: (q) => {
          seen.query = q;
        },
        onEnd: () => {
          ended = true;
        },
      }),
    });

    expect(seen.query).toBe("SELECT 1");
    expect(ended).toBe(true);
  });

  test("rejects when the required schema query returns no rows", async () => {
    let ended = false;

    await expect(
      checkPostgresReadiness({
        databaseUrl: "postgres://example",
        schemaName: "cms",
        createClient: createStubClient({
          queryResult: [],
          onEnd: () => {
            ended = true;
          },
        }),
      }),
    ).rejects.toThrow("Required database schema is unavailable");

    expect(ended).toBe(true);
  });

  test("always attempts to close the client even if the query fails", async () => {
    let ended = false;

    await expect(
      checkPostgresReadiness({
        databaseUrl: "postgres://example",
        schemaName: "cms",
        createClient: (_databaseUrl: string, _options: unknown) => {
          const sql = (async () => {
            throw new Error("boom");
          }) as unknown as SqlTag;
          sql.end = async () => {
            ended = true;
          };
          return sql;
        },
      }),
    ).rejects.toThrow("boom");

    expect(ended).toBe(true);
  });
});
