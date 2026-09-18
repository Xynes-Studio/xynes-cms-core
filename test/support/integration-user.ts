import { db } from "../../src/infra/db";
import { identityUsers } from "../../src/infra/db/schema";
import { eq } from "drizzle-orm";

const LOCAL_INTEGRATION_USER_ID = "00000000-0000-4000-8000-000000000001";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getIntegrationUserId(): Promise<string> {
  const integrationUserId =
    process.env.CMS_INTEGRATION_USER_ID?.trim() || LOCAL_INTEGRATION_USER_ID;

  if (!UUID_PATTERN.test(integrationUserId)) {
    throw new Error("CMS_INTEGRATION_USER_ID must be a valid UUID");
  }

  const [user] = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .where(eq(identityUsers.id, integrationUserId))
    .limit(1);

  if (!user) {
    throw new Error(
      "Dedicated CMS integration identity is missing; provision it through the identity owner and set CMS_INTEGRATION_USER_ID",
    );
  }

  return user.id;
}
