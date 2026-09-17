import { db } from "../../src/infra/db";
import { identityUsers } from "../../src/infra/db/schema";

const INTEGRATION_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function getIntegrationUserId(): Promise<string> {
  const [user] = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .limit(1);

  if (user) {
    return user.id;
  }

  await db
    .insert(identityUsers)
    .values({
      id: INTEGRATION_USER_ID,
      email: "cms-integration@local.invalid",
      displayName: "CMS Integration Test",
    })
    .onConflictDoNothing();

  return INTEGRATION_USER_ID;
}
