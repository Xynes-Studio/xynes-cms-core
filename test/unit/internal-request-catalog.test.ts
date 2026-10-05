import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INTERNAL_REQUEST_RECEIVERS } from "../../src/infra/security/internal-request";

test("receiver capabilities match the production registration catalog", () => {
  const source = readFileSync(
    new URL("../../src/actions/index.ts", import.meta.url),
    "utf8",
  );
  const registered = Array.from(
    source.matchAll(/registerAction\(\s*['"]([^'"]+)['"]/g),
    (match) => match[1],
  ).sort();
  const allowed: readonly string[] =
    INTERNAL_REQUEST_RECEIVERS["cms-service"].operations;
  expect(registered.length).toBeGreaterThan(0);
  expect([...allowed].sort()).toEqual(registered);
});
