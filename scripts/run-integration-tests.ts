const integrationTestFiles = [
  "test/comments.test.ts",
  "test/cms.test.ts",
  "test/seed.test.ts",
  "test/integration/blog-entry.test.ts",
  "test/integration/cms-meta-actions.test.ts",
  "test/integration/comments-create.test.ts",
  "test/integration/comments-list.test.ts",
  "test/integration/content-create.test.ts",
  "test/integration/content-published.test.ts",
  "test/integration/content-type-ensure-defaults.test.ts",
  "test/integration/entry-status-lifecycle.test.ts",
];

for (const testFile of integrationTestFiles) {
  console.log(`\n=== ${testFile}`);

  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "test",
      "--preload",
      "./test/integration/allow-authz.preload.ts",
      testFile,
    ],
    env: {
      ...process.env,
      RUN_INTEGRATION_TESTS: "true",
    },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
