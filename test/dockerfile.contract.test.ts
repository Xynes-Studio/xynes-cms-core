import { describe, expect, test } from "bun:test";

const BUN_ALPINE_IMAGE =
  "oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0";

describe("H-4 production image contract", () => {
  test("ships a non-root CMS runtime with healthcheck and migrations", async () => {
    const dockerfile = await Bun.file("Dockerfile").text();
    const packageJson = await Bun.file("package.json").json();
    const dockerignoreFile = Bun.file(".dockerignore");
    const dockerignore = (await dockerignoreFile.exists())
      ? await dockerignoreFile.text()
      : "";

    expect(dockerfile).toContain(`FROM ${BUN_ALPINE_IMAGE} AS base`);
    expect(dockerfile).toContain("FROM base AS dev");
    expect(dockerfile).toContain(`FROM ${BUN_ALPINE_IMAGE} AS prod`);
    expect(dockerfile).toContain("COPY drizzle ./drizzle");
    expect(dockerfile).toContain("addgroup -S -g 1001 xynes");
    expect(dockerfile).toContain("adduser -S -u 1001 -G xynes -H xynes");
    expect(dockerfile).toContain("bun install --production --frozen-lockfile");
    expect(dockerfile).toContain("ENV PORT=4202");
    expect(dockerfile).toContain("USER xynes");
    expect(dockerfile).toContain("EXPOSE 4202");
    expect(dockerfile).toContain(
      "HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun run healthcheck || exit 1",
    );
    expect(dockerfile).toContain('CMD ["bun", "run", "src/index.ts"]');

    expect(packageJson.scripts.healthcheck).toContain("127.0.0.1");
    expect(packageJson.scripts.healthcheck).toContain("process.env.PORT||4202");
    expect(packageJson.scripts.healthcheck).toContain("/health");

    expect(dockerignore.split(/\r?\n/)).not.toContain("drizzle");
    expect(dockerignore.split(/\r?\n/)).not.toContain("drizzle/");
  });
});