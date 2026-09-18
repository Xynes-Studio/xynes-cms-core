import { setAuthzClient } from "../../src/infra/authz";

// Database integration fixtures use isolated workspace/user IDs that are not
// seeded into the RBAC tables. Authorization behavior has its own dedicated
// suite, so keep these tests focused on CMS routes and persistence.
setAuthzClient({
  check: async () => ({ allowed: true }),
});
