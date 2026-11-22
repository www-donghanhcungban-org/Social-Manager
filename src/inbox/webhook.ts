import { and, eq } from "drizzle-orm";

import { UUID } from "../auth/access";
import type { Db } from "../auth/members";
import { inboxItems, providerConnections, socialAccounts } from "../db/schema";
import {
  parseWebhookEvent,
  verifyWebhookSignature,
} from "../providers/socialapi/webhook";
import { ValidationError } from "../providers/types";
import type { SecretBox } from "../security/secret-box";

/** Webhook thật chỉ vài KB; trần này chặn kẻ gửi thân khổng lồ trước khi tốn CPU băm/giải mã. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface WebhookResponse {
  status: 200 | 400 | 401 | 413;
  body: {
    status: "ok" | "ignored" | "unauthorized" | "invalid" | "too_large";
    inserted?: number;
  };
}

const UNAUTHORIZED: WebhookResponse = {
  status: 401,
  body: { status: "unauthorized" },
};

/**
 * Nhận webhook SocialAPI cho một kết nối. Xác thực bằng chữ ký chứ không bằng phiên đăng nhập; mọi lý do
 * xác thực thất bại (kết nối không có, chưa bật, sai nhà cung cấp, sai chữ ký, timestamp cũ) cho cùng
 * một phản hồi 401 để không dò được kết nối nào tồn tại. Lỗi CSDL được ném ra (route trả 500) để nhà
 * cung cấp thử lại theo lịch của họ.
 */
export function createWebhookIngest({
  db,
  box,
  now = () => Date.now(),
}: {
  db: Db;
  box: SecretBox;
  now?: () => number;
}) {
  return {
    async handle(input: {
      connectionId: string;
      rawBody: Buffer;
      timestamp: string | null;
      signature: string | null;
    }): Promise<WebhookResponse> {
      if (input.rawBody.length > MAX_WEBHOOK_BYTES)
        return { status: 413, body: { status: "too_large" } };
      if (!UUID.test(input.connectionId)) return UNAUTHORIZED;

      const [conn] = await db
        .select({
          id: providerConnections.id,
          workspaceId: providerConnections.workspaceId,
          provider: providerConnections.provider,
          secretEnc: providerConnections.webhookSecretEnc,
        })
        .from(providerConnections)
        .where(eq(providerConnections.id, input.connectionId));
      if (!conn || conn.provider !== "socialapi" || conn.secretEnc === null)
        return UNAUTHORIZED;

      const valid = verifyWebhookSignature({
        secret: box.decrypt(conn.secretEnc),
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        signature: input.signature,
        nowMs: now(),
      });
      if (!valid) return UNAUTHORIZED;

      let event;
      try {
        event = parseWebhookEvent(JSON.parse(input.rawBody.toString("utf8")));
      } catch (e) {
        if (e instanceof ValidationError || e instanceof SyntaxError)
          return { status: 400, body: { status: "invalid" } };
        throw e;
      }
      if (event.type === "ignored")
        return { status: 200, body: { status: "ignored" } };

      const [account] = await db
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.connectionId, conn.id),
            eq(socialAccounts.externalId, event.accountExternalId),
          ),
        );
      // Tài khoản chưa được thêm vào app: thử lại không giúp gì, nên xác nhận 200 và bỏ qua.
      if (!account) return { status: 200, body: { status: "ignored" } };

      const inserted = await db
        .insert(inboxItems)
        .values({
          workspaceId: conn.workspaceId,
          socialAccountId: account.id,
          kind: event.kind,
          ...event.item,
        })
        .onConflictDoNothing({
          target: [
            inboxItems.socialAccountId,
            inboxItems.kind,
            inboxItems.externalId,
          ],
        })
        .returning({ id: inboxItems.id });
      return {
        status: 200,
        body: { status: "ok", inserted: inserted.length },
      };
    },
  };
}
