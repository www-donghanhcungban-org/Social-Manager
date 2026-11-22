import { and, eq } from "drizzle-orm";

import { providerConnections, socialAccounts } from "../db/schema";
import { ForbiddenError, NotFoundError } from "./errors";
import { getRole, type Db } from "./members";
import { can, type Action } from "./permissions";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Người làm không có quyền (hoặc không phải thành viên) → Forbidden, không phân biệt hai trường hợp. */
export async function requireAction(
  db: Db,
  actorId: string,
  workspaceId: string,
  action: Action,
) {
  if (!can(await getRole(db, workspaceId, actorId), action))
    throw new ForbiddenError();
}

export interface AccountTarget {
  id: string;
  platform: string;
  externalId: string;
  provider: string;
  credentialsEnc: string;
}

/** Tài khoản mạng xã hội phải thuộc đúng workspace; sai workspace hay id lạ đều là NotFound. */
export async function accountInWorkspace(
  db: Db,
  accountId: string,
  workspaceId: string,
): Promise<AccountTarget> {
  if (!UUID.test(accountId)) throw new NotFoundError();
  const [row] = await db
    .select({
      id: socialAccounts.id,
      platform: socialAccounts.platform,
      externalId: socialAccounts.externalId,
      provider: providerConnections.provider,
      credentialsEnc: providerConnections.credentialsEnc,
    })
    .from(socialAccounts)
    .innerJoin(
      providerConnections,
      eq(socialAccounts.connectionId, providerConnections.id),
    )
    .where(
      and(
        eq(socialAccounts.id, accountId),
        eq(providerConnections.workspaceId, workspaceId),
      ),
    );
  if (!row) throw new NotFoundError();
  return row;
}
