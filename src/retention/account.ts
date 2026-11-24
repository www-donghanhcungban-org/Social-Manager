import { and, count, desc, eq, inArray, ne } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import {
  ConflictError,
  ForbiddenError,
  TooManyAttemptsError,
} from "../auth/errors";
import type { Db } from "../auth/members";
import { verifyPassword } from "../auth/password";
import type { createLoginThrottle } from "../auth/throttle";
import {
  account,
  auditEvents,
  consents,
  evidenceBlobs,
  members,
  session,
  user,
  workspaces,
} from "../db/schema";
import type { EvidenceService } from "../evidence/service";
import type { Logger } from "../log/logger";
import { defaultLogger } from "../log/process";
import { logSecurityEvent } from "../log/security-events";

type LoginThrottle = ReturnType<typeof createLoginThrottle>;

export interface AccountExport {
  exportedAt: string;
  profile: { name: string; email: string; createdAt: string };
  memberships: { workspaceId: string; workspaceName: string; role: string }[];
  consents: {
    workspaceId: string;
    purpose: string;
    policyVersion: string;
    channel: string;
    grantedAt: string;
    withdrawnAt: string | null;
  }[];
  /** Phiên đăng nhập đang lưu: thời điểm và địa chỉ/thiết bị (không kèm mã phiên). */
  sessions: {
    createdAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }[];
  /** Hành động của chính bạn trong sổ audit (loại, đối tượng, thời điểm, địa chỉ nguồn). */
  auditEvents: {
    createdAt: string;
    workspaceId: string;
    action: string;
    targetType: string;
    outcome: string;
    sourceIp: string | null;
  }[];
}

export interface AccountErasure {
  /** Workspace chỉ có bạn là thành viên: đã xoá cùng toàn bộ dữ liệu bên trong. */
  workspacesDeleted: number;
  /** Workspace còn người khác: bạn bị gỡ khỏi danh sách thành viên, dữ liệu của workspace ở lại. */
  membershipsRemoved: number;
  consents: number;
  sessions: number;
  blobs: number;
}

/** Trần số dòng audit trong một lần xuất (đủ cho hàng chục nghìn hành động; vượt thì cắt và báo). */
const AUDIT_EXPORT_MAX = 10_000;

/**
 * Quyền của chủ tài khoản (STD-PRIV-004, CMP-RIGHTS-007): xem/xuất dữ liệu của chính mình và xoá tài khoản tự phục vụ.
 * Mọi thao tác chỉ dùng `userId` của phiên (không nhận id người khác). Xoá đòi nhập lại mật khẩu.
 *
 * Căn cứ giữ lại sau khi xoá: dòng `audit_events` (append-only, ghi nhận an ninh — `actor_id` chỉ còn là mã không còn
 * gắn với tên/email nào) và các cột `*_by`/`actor_id` trong dữ liệu của workspace còn lại; xem
 * `docs/compliance/data-inventory.csv`.
 */
export function createAccountRightsService({
  db,
  evidence,
  throttle,
  log = defaultLogger(),
  now = () => new Date(),
}: {
  db: Db;
  evidence: Pick<EvidenceService, "sweepOrphanBlobs" | "releaseFiles">;
  /**
   * Giới hạn thử mật khẩu theo tài khoản, dùng chung cơ chế với đăng nhập (`createLoginThrottle`). Bước nhập lại mật
   * khẩu để xoá tài khoản là một phép dò mật khẩu cho bất kỳ ai giữ được phiên (AUD-CODE-008), nên không để trống.
   */
  throttle: Pick<LoginThrottle, "tryAttempt" | "recordSuccess">;
  log?: Logger;
  now?: () => Date;
}) {
  return {
    async exportMyData(input: { userId: string }): Promise<AccountExport> {
      const [u] = await db.select().from(user).where(eq(user.id, input.userId));
      if (!u) throw new ForbiddenError();
      const mem = await db
        .select({
          workspaceId: members.workspaceId,
          workspaceName: workspaces.name,
          role: members.role,
        })
        .from(members)
        .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
        .where(eq(members.userId, u.id))
        .orderBy(workspaces.name, members.workspaceId);
      const cons = await db
        .select()
        .from(consents)
        .where(eq(consents.subjectId, u.id))
        .orderBy(desc(consents.createdAt), desc(consents.id));
      const sess = await db
        .select()
        .from(session)
        .where(eq(session.userId, u.id))
        .orderBy(desc(session.createdAt));
      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, u.id))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(AUDIT_EXPORT_MAX);
      // Dấu vết việc xuất: ghi ở mọi workspace người dùng thuộc về (sổ audit gắn theo workspace).
      for (const m of mem)
        await recordAudit(db, {
          workspaceId: m.workspaceId,
          actorId: u.id,
          action: "data.exported",
          targetType: "account",
          targetId: u.id,
        });
      return {
        exportedAt: now().toISOString(),
        profile: {
          name: u.name,
          email: u.email,
          createdAt: u.createdAt.toISOString(),
        },
        memberships: mem,
        consents: cons.map((c) => ({
          workspaceId: c.workspaceId,
          purpose: c.purposeId,
          policyVersion: c.policyVersion,
          channel: c.channel,
          grantedAt: c.grantedAt.toISOString(),
          withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
        })),
        sessions: sess.map((s) => ({
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
        })),
        auditEvents: audits.map((a) => ({
          createdAt: a.createdAt.toISOString(),
          workspaceId: a.workspaceId,
          action: a.action,
          targetType: a.targetType,
          outcome: a.outcome,
          sourceIp: a.sourceIp,
        })),
      };
    },

    /**
     * Xoá tài khoản: kiểm mật khẩu → từ chối nếu bạn là owner duy nhất của workspace còn người khác (phải chuyển quyền
     * hoặc gỡ họ trước) → xoá workspace chỉ có mình bạn (cascade mọi dữ liệu) → gỡ khỏi workspace còn lại → xoá bản ghi
     * đồng ý, phiên, đăng nhập, người dùng → dọn blob mồ côi. Một giao dịch cho phần CSDL.
     */
    async deleteAccount(input: {
      userId: string;
      password: string;
    }): Promise<AccountErasure> {
      const [cred] = await db
        .select({ hash: account.password })
        .from(account)
        .where(
          and(
            eq(account.userId, input.userId),
            eq(account.providerId, "credential"),
          ),
        );
      // Giữ chỗ một lần thử TRƯỚC khi kiểm mật khẩu (nguyên tử với kiểm khoá, như đăng nhập): sai thì lần thử đã được
      // tính, đúng thì xoá bộ đếm. Khoá riêng theo hành động và userId nên không đụng khoá đăng nhập theo email.
      const gate = `reauth:delete-account:${input.userId}`;
      const event = {
        actor: input.userId,
        targetType: "account_delete",
        outcome: "denied",
      } as const;
      if (!(await throttle.tryAttempt(gate))) {
        logSecurityEvent(log, { event: "auth.login_locked", ...event });
        throw new TooManyAttemptsError();
      }
      const ok =
        typeof input.password === "string" &&
        input.password.length > 0 &&
        cred?.hash != null &&
        (await verifyPassword({ hash: cred.hash, password: input.password }));
      if (!ok) {
        logSecurityEvent(log, { event: "auth.login_failed", ...event });
        throw new ForbiddenError("Mật khẩu không đúng");
      }
      await throttle.recordSuccess(gate);

      const out: AccountErasure = {
        workspacesDeleted: 0,
        membershipsRemoved: 0,
        consents: 0,
        sessions: 0,
        blobs: 0,
      };
      const shas: string[] = [];
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db;
        // Đếm trước: đồng ý nằm trong workspace bị xoá sẽ đi theo khoá ngoại, không còn để `returning` đếm.
        out.consents = (
          await tx
            .select({ n: count() })
            .from(consents)
            .where(eq(consents.subjectId, input.userId))
        )[0]!.n;
        const mine = await tx
          .select({ workspaceId: members.workspaceId, role: members.role })
          .from(members)
          .where(eq(members.userId, input.userId));
        const solo: string[] = [];
        const leave: string[] = [];
        for (const m of mine) {
          const [{ others } = { others: 0 }] = await tx
            .select({ others: count() })
            .from(members)
            .where(
              and(
                eq(members.workspaceId, m.workspaceId),
                ne(members.userId, input.userId),
              ),
            );
          if (others === 0) {
            solo.push(m.workspaceId);
            continue;
          }
          if (m.role === "owner") {
            const [{ owners } = { owners: 0 }] = await tx
              .select({ owners: count() })
              .from(members)
              .where(
                and(
                  eq(members.workspaceId, m.workspaceId),
                  eq(members.role, "owner"),
                  ne(members.userId, input.userId),
                ),
              );
            if (owners === 0)
              throw new ConflictError(
                "owner_has_members",
                "Bạn là chủ duy nhất của một workspace còn thành viên khác: hãy chuyển quyền chủ hoặc gỡ họ trước khi xoá tài khoản",
              );
          }
          leave.push(m.workspaceId);
        }

        // Dấu vết trước khi xoá (sổ audit không có khoá ngoại tới workspace nên còn lại sau xoá).
        for (const w of solo)
          await recordAudit(tx, {
            workspaceId: w,
            actorId: input.userId,
            action: "data.erased",
            targetType: "workspace",
            targetId: w,
            reason: "account_deleted",
          });
        for (const w of leave)
          await recordAudit(tx, {
            workspaceId: w,
            actorId: input.userId,
            action: "member.removed",
            targetType: "member",
            targetId: input.userId,
            reason: "account_deleted",
          });

        if (solo.length > 0) {
          // Khoá ngoại theo tầng xoá luôn dòng blob của workspace: ghi lại hash để dọn tệp sau giao dịch.
          const gone = await tx
            .select({ sha: evidenceBlobs.sha256 })
            .from(evidenceBlobs)
            .where(inArray(evidenceBlobs.workspaceId, solo));
          shas.push(...gone.map((g) => g.sha));
          await tx.delete(workspaces).where(inArray(workspaces.id, solo));
        }
        if (leave.length > 0)
          await tx
            .delete(members)
            .where(
              and(
                eq(members.userId, input.userId),
                inArray(members.workspaceId, leave),
              ),
            );
        out.workspacesDeleted = solo.length;
        out.membershipsRemoved = leave.length;
        await tx.delete(consents).where(eq(consents.subjectId, input.userId));
        out.sessions = (
          await tx
            .select({ n: count() })
            .from(session)
            .where(eq(session.userId, input.userId))
        )[0]!.n;
        // `session` và `account` đi theo khoá ngoại ON DELETE CASCADE của người dùng.
        await tx.delete(user).where(eq(user.id, input.userId));
      });

      out.blobs += (await evidence.releaseFiles(shas)).files;
      for (let i = 0; i < 20; i++) {
        const r = await evidence.sweepOrphanBlobs({ limit: 500 });
        out.blobs += r.blobs;
        if (r.blobs < 500) break;
      }
      return out;
    },
  };
}

export type AccountRightsService = ReturnType<
  typeof createAccountRightsService
>;
