export const config = {
  port: process.env.PORT || 3000,
  databaseUrl:
    process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/db", // Placeholder as per plan
  defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID,
  authzServiceUrl: process.env.AUTHZ_SERVICE_URL || "http://localhost:4300",
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || "",
};
