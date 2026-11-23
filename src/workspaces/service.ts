import { asc, count, eq } from "drizzle-orm";

import { requireAction } from "../auth/access";
import { ConflictError, NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  MAX_RETENTION_DAYS,
  members,
  workspaces,
  type Role,
} from "../db/schema";
import { ValidationError } from "../providers/types";
import { DEFAULT_INBOX_DAYS } from "../retention/service";

export interface WorkspaceView {
  id: string;
  name: string;
  role: Role;
}

export interface RetentionView {
  /** Số ngày đang áp dụng (đã tính mặc định); null khi giữ vô thời hạn. */
  effectiveDays: number | null;
  /** Giá trị đã đặt; null = dùng mặc định. */
  days: number | null;
  forever: boolean;
}

const toRetention = (days: number | null, forever: boolean): RetentionView => ({
  effectiveDays: forever ? null : (days ?? DEFAULT_INBOX_DAYS),
  days,
  forever,
});

const MAX_NAME = 100;
/** Trần số workspace mỗi người tạo: chặn lạm dụng tạo hàng loạt. */
export const MAX_WORKSPACES_PER_USER = 20;

export function createWorkspaceService({ db }: { db: Db }) {
  return {
    /** Tạo workspace và đặt người tạo làm owner trong một giao dịch: không có workspace mồ côi. */
    async create(input: {
      actorId: string;
      name: string;
    }): Promise<WorkspaceView> {
      if (input.actorId.trim() === "")
        throw new ValidationError("Thiếu người dùng");
      const name = input.name.normalize("NFC").trim();
      if (name === "" || name.length > MAX_NAME)
        throw new ValidationError(`Tên phải dài 1-${MAX_NAME} ký tự`);
      return db.transaction(async (tx) => {
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(members)
          .where(eq(members.userId, input.actorId));
        if (n >= MAX_WORKSPACES_PER_USER)
          throw new ConflictError(
            "workspace_limit",
            `Mỗi người tối đa ${MAX_WORKSPACES_PER_USER} workspace`,
          );
        const [ws] = await tx.insert(workspaces).values({ name }).returning();
        await tx.insert(members).values({
          workspaceId: ws!.id,
          userId: input.actorId,
          role: "owner",
        });
        return { id: ws!.id, name: ws!.name, role: "owner" as const };
      });
    },

    /** Thời hạn lưu tin của workspace (thành viên xem được để biết dữ liệu còn bao lâu). */
    async getRetention(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<RetentionView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const [row] = await db
        .select({
          days: workspaces.inboxRetentionDays,
          forever: workspaces.retainInboxForever,
        })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId));
      if (!row) throw new NotFoundError();
      return toRetention(row.days, row.forever);
    },

    /**
     * Owner đặt thời hạn lưu (D-010): `days` 1..36500 hoặc null (= mặc định 365); `forever` bỏ qua `days` và không xoá
     * gì — chỉ bật khi có căn cứ pháp lý (PROJECT.md §5).
     */
    async setRetention(input: {
      actorId: string;
      workspaceId: string;
      days: number | null;
      forever: boolean;
    }): Promise<RetentionView> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "workspace.settings",
      );
      if (
        input.days !== null &&
        (!Number.isInteger(input.days) ||
          input.days < 1 ||
          input.days > MAX_RETENTION_DAYS)
      )
        throw new ValidationError(
          `Số ngày lưu phải là số nguyên 1-${MAX_RETENTION_DAYS}`,
        );
      if (typeof input.forever !== "boolean")
        throw new ValidationError("Giá trị giữ vô thời hạn không hợp lệ");
      const [row] = await db
        .update(workspaces)
        .set({
          inboxRetentionDays: input.days,
          retainInboxForever: input.forever,
        })
        .where(eq(workspaces.id, input.workspaceId))
        .returning({
          days: workspaces.inboxRetentionDays,
          forever: workspaces.retainInboxForever,
        });
      if (!row) throw new NotFoundError();
      return toRetention(row.days, row.forever);
    },

    /** Cờ cho phép gửi dữ liệu tới AI đám mây (H6). Thành viên xem được để biết dữ liệu có thể rời máy hay không. */
    async getAiCloud(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<{ enabled: boolean }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const [row] = await db
        .select({ on: workspaces.aiCloudEnabled })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId));
      if (!row) throw new NotFoundError();
      return { enabled: row.on };
    },

    /** Chỉ owner bật/tắt: bật nghĩa là trích đoạn tin của khách có thể được gửi ra ngoài máy chủ (cần căn cứ pháp lý). */
    async setAiCloud(input: {
      actorId: string;
      workspaceId: string;
      enabled: boolean;
    }): Promise<{ enabled: boolean }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "workspace.settings",
      );
      if (typeof input.enabled !== "boolean")
        throw new ValidationError("Giá trị không hợp lệ");
      const [row] = await db
        .update(workspaces)
        .set({ aiCloudEnabled: input.enabled })
        .where(eq(workspaces.id, input.workspaceId))
        .returning({ on: workspaces.aiCloudEnabled });
      if (!row) throw new NotFoundError();
      return { enabled: row.on };
    },

    /** Chính sách gửi tin của workspace (thành viên xem được để biết vì sao một yêu cầu gửi bị chặn). */
    async getOutbound(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<{ enabled: boolean; maxPerHour: number }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const [row] = await db
        .select({
          on: workspaces.outboundEnabled,
          max: workspaces.outboundMaxPerHour,
        })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId));
      if (!row) throw new NotFoundError();
      return { enabled: row.on, maxPerHour: row.max };
    },

    /**
     * Owner bật/tắt gửi tin và đặt hạn mức giờ. Bật chỉ là MỘT trong hai khoá: gửi thật còn cần cờ hệ thống `OUTBOUND_LIVE`.
     * Mặc định tắt, hạn mức 10/giờ.
     */
    async setOutbound(input: {
      actorId: string;
      workspaceId: string;
      enabled: boolean;
      maxPerHour?: number;
    }): Promise<{ enabled: boolean; maxPerHour: number }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "workspace.settings",
      );
      if (typeof input.enabled !== "boolean")
        throw new ValidationError("Giá trị không hợp lệ");
      if (
        input.maxPerHour !== undefined &&
        (!Number.isInteger(input.maxPerHour) ||
          input.maxPerHour < 0 ||
          input.maxPerHour > 1000)
      )
        throw new ValidationError("Hạn mức giờ phải là số nguyên 0-1000");
      const [row] = await db
        .update(workspaces)
        .set({
          outboundEnabled: input.enabled,
          ...(input.maxPerHour === undefined
            ? {}
            : { outboundMaxPerHour: input.maxPerHour }),
        })
        .where(eq(workspaces.id, input.workspaceId))
        .returning({
          on: workspaces.outboundEnabled,
          max: workspaces.outboundMaxPerHour,
        });
      if (!row) throw new NotFoundError();
      return { enabled: row.on, maxPerHour: row.max };
    },

    async listForUser(userId: string): Promise<WorkspaceView[]> {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: members.role,
        })
        .from(members)
        .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
        .where(eq(members.userId, userId))
        .orderBy(asc(workspaces.name), asc(workspaces.id));
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
