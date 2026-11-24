import { and, desc, eq } from "drizzle-orm";

import { textHashOf } from "../actions/text-hash";
import type { Db } from "../auth/members";
import { consents, type ConsentPurpose } from "../db/schema";

/** Phiên bản văn bản đồng ý; đổi nội dung văn bản thì đổi hằng này (CMP-VN-001). */
export const CONSENT_POLICY_VERSION = "2026-11-24";

/**
 * Văn bản người dùng thấy khi bật AI đám mây (CMP-VN-001: loại dữ liệu, mục đích, bên nhận). Băm sha256 của đúng chuỗi
 * này lưu ở `consents.ui_snapshot_hash`: sửa chữ mà quên đổi `CONSENT_POLICY_VERSION` bị test bắt.
 */
export const CONSENT_TEXT: Record<ConsentPurpose, string> = {
  ai_cloud:
    "Cho phép gửi trích đoạn tin nhắn và tài liệu của workspace này tới dịch vụ AI đám mây do máy chủ cấu hình, chỉ để trả lời câu hỏi bạn đặt ra. Số điện thoại, email, số căn cước và địa chỉ bị che trước khi gửi. Bạn chịu trách nhiệm có căn cứ pháp lý và đã thông báo cho người nhắn tin. Bạn rút lại được bất cứ lúc nào ở cùng trang này; rút xong, không có trích đoạn nào được gửi nữa.",
};

export const consentTextHash = (p: ConsentPurpose): string =>
  textHashOf(CONSENT_TEXT[p]);

type Row = typeof consents.$inferSelect;
export interface ConsentState {
  /** Đang được đồng ý: dòng mới nhất là dòng cấp. Không có dòng nào = chưa đồng ý. */
  granted: boolean;
  latest: Row | null;
}

/** Trạng thái hiện tại = dòng mới nhất của (workspace, mục đích). */
export async function currentConsent(
  db: Db,
  workspaceId: string,
  purpose: ConsentPurpose,
): Promise<ConsentState> {
  const [latest] = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.workspaceId, workspaceId),
        eq(consents.purposeId, purpose),
      ),
    )
    .orderBy(desc(consents.createdAt), desc(consents.id))
    .limit(1);
  return {
    granted: latest !== undefined && latest.withdrawnAt === null,
    latest: latest ?? null,
  };
}

/** Cấp đồng ý: thêm một dòng mới (không sửa dòng cũ). Gọi trong cùng giao dịch với thay đổi cờ. */
export async function recordGrant(
  db: Db,
  input: {
    workspaceId: string;
    subjectId: string;
    purpose: ConsentPurpose;
    now: Date;
    channel?: string;
  },
): Promise<Row> {
  const prev = await currentConsent(db, input.workspaceId, input.purpose);
  const createdAt = afterLatest(input.now, prev.latest);
  const [row] = await db
    .insert(consents)
    .values({
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      purposeId: input.purpose,
      policyVersion: CONSENT_POLICY_VERSION,
      grantedAt: createdAt,
      channel: input.channel ?? "web",
      uiSnapshotHash: consentTextHash(input.purpose),
      withdrawnAt: null,
      createdAt,
    })
    .returning();
  return row!;
}

/**
 * Rút đồng ý: thêm một dòng mới giữ nguyên `granted_at` của lần cấp, `withdrawn_at` = bây giờ. Không có lần cấp đang
 * hiệu lực thì không làm gì (trả null): rút hai lần không tạo dòng thừa.
 */
export async function recordWithdrawal(
  db: Db,
  input: {
    workspaceId: string;
    subjectId: string;
    purpose: ConsentPurpose;
    now: Date;
    channel?: string;
  },
): Promise<Row | null> {
  const prev = await currentConsent(db, input.workspaceId, input.purpose);
  if (!prev.granted || !prev.latest) return null;
  const createdAt = afterLatest(input.now, prev.latest);
  const [row] = await db
    .insert(consents)
    .values({
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      purposeId: input.purpose,
      policyVersion: prev.latest.policyVersion,
      grantedAt: prev.latest.grantedAt,
      channel: input.channel ?? "web",
      uiSnapshotHash: consentTextHash(input.purpose),
      withdrawnAt: createdAt,
      createdAt,
    })
    .returning();
  return row!;
}

/** Dòng mới luôn đứng sau dòng trước dù đồng hồ lệch hoặc hai lần ghi trong cùng một mili giây. */
function afterLatest(now: Date, latest: Row | null): Date {
  if (!latest) return now;
  const min = latest.createdAt.getTime() + 1;
  return now.getTime() >= min ? now : new Date(min);
}
