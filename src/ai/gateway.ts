import { and, count, eq, gte, ne, sql } from "drizzle-orm";

import { requireAction } from "../auth/access";
import type { Db } from "../auth/members";
import { aiDisclosures, workspaces } from "../db/schema";
import type { Logger } from "../log/logger";
import { logSecurityEvent } from "../log/security-events";
import type { Metrics } from "../observability/metrics";
import { ValidationError } from "../providers/types";
import { currentConsent } from "../workspaces/consent";
import {
  AiBudgetError,
  AiDisabledError,
  AiNotAllowedError,
  ModelError,
  type ModelPort,
  type ModelResponse,
} from "./port";
import { redactPii, totalRedactions } from "./redact";

/** Trần dữ liệu gửi một lượt (system + user): chặn đẩy cả kho tài liệu ra ngoài trong một lần gọi. */
export const MAX_PROMPT_BYTES = 200_000;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Cửa duy nhất tới mô hình. Thứ tự (mọi bước đều thất bại ĐÓNG):
 * 1) AI phải được cấu hình; 2) người gọi có quyền đọc kho; 3) trần byte;
 * 4) điểm cuối không phải máy cục bộ → workspace phải bật `ai_cloud_enabled` (không thì ghi `blocked`, không gửi);
 * 5) GHI nhật ký `sent` trước khi gửi — không ghi được thì không gửi; 6) gửi; 7) cập nhật `ok`/`error` kèm mã an toàn.
 * Nhật ký chỉ có số mục/byte/điểm cuối — không có nội dung.
 */
/** Ngân sách mỗi workspace trong cửa sổ 24 giờ trượt (cấu hình được; thực thi bằng mã). */
export interface AiBudget {
  /** Tổng số lượt gọi (mọi tính năng). */
  maxCallsPerDay: number;
  /** Tổng byte gửi đi (xấp xỉ token, đo được trước khi gửi). */
  maxBytesPerDay: number;
  /** Trần số lượt cho MỘT tính năng (`purpose`). */
  maxCallsPerPurposePerDay: number;
}

export const DEFAULT_AI_BUDGET: AiBudget = {
  maxCallsPerDay: 500,
  maxBytesPerDay: 20_000_000,
  maxCallsPerPurposePerDay: 300,
};

/** Cảnh báo ở 80%, bóp (chặn lượt mới) ở 100%: kiểm bằng mã trước khi gửi. */
export const BUDGET_WARN_RATIO = 0.8;

export function createAiGateway({
  db,
  model,
  log,
  budget = DEFAULT_AI_BUDGET,
  metrics,
  redact = true,
}: {
  db: Db;
  /** null = AI tắt. */
  model: ModelPort | null;
  log?: Logger;
  budget?: AiBudget;
  metrics?: Pick<Metrics, "addLlmTokens">;
  /**
   * Che PII (SĐT, CCCD, email, địa chỉ) trong phần dữ liệu gửi tới điểm cuối KHÔNG cục bộ (CMP-PRIV-010). Mặc định bật;
   * đây là cấu hình dựng cổng (mã/test), không phải tham số của người gọi hay của client (AI-GUARD-005).
   */
  redact?: boolean;
}) {
  /** Tỉ lệ đã dùng (0..) của cửa sổ 24 giờ; lượt `blocked` không tính vì không gửi gì. */
  async function usage(workspaceId: string, purpose: string) {
    const since = sql`now() - interval '24 hours'`;
    const [row] = await db
      .select({
        calls: count(),
        bytes: sql<number>`coalesce(sum(${aiDisclosures.bytesSent}), 0)`,
        purposeCalls: sql<number>`count(*) filter (where ${aiDisclosures.purpose} = ${purpose})`,
      })
      .from(aiDisclosures)
      .where(
        and(
          eq(aiDisclosures.workspaceId, workspaceId),
          gte(aiDisclosures.createdAt, since as unknown as Date),
          ne(aiDisclosures.status, "blocked"),
        ),
      );
    const calls = Number(row?.calls ?? 0);
    const bytes = Number(row?.bytes ?? 0);
    const purposeCalls = Number(row?.purposeCalls ?? 0);
    return {
      ratio: Math.max(
        calls / budget.maxCallsPerDay,
        bytes / budget.maxBytesPerDay,
        purposeCalls / budget.maxCallsPerPurposePerDay,
      ),
    };
  }

  const disclosure = (
    input: { actorId: string; workspaceId: string; purpose: string },
    m: ModelPort,
    counts: { itemCount: number; bytesSent: number },
    status: "sent" | "blocked",
  ) =>
    db
      .insert(aiDisclosures)
      .values({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        purpose: input.purpose,
        endpointHost: m.host,
        model: m.model,
        local: m.local,
        itemCount: counts.itemCount,
        bytesSent: status === "blocked" ? 0 : counts.bytesSent,
        status,
      })
      .returning({ id: aiDisclosures.id });

  return {
    get enabled() {
      return model !== null;
    },

    async complete(input: {
      actorId: string;
      workspaceId: string;
      /** Mục đích ngắn (vd `answer`) để đối soát nhật ký. */
      purpose: string;
      system: string;
      user: string;
      /** Số mục bằng chứng đưa vào lời nhắc (để ghi nhật ký). */
      itemCount: number;
      maxOutputTokens?: number;
    }): Promise<{
      text: string;
      disclosureId: string;
      stopReason?: ModelResponse["stopReason"];
    }> {
      if (!model) throw new AiDisabledError();
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.read",
      );
      if (!SAFE_CODE.test(input.purpose))
        throw new ValidationError("Mục đích gọi AI không hợp lệ");
      if (!Number.isInteger(input.itemCount) || input.itemCount < 0)
        throw new ValidationError("Số mục không hợp lệ");
      // Che PII trước khi gửi ra ngoài máy/mạng người dùng; điểm cuối cục bộ giữ nguyên văn (dữ liệu không rời đi).
      const redaction = redact && !model.local ? redactPii(input.user) : null;
      const user = redaction ? redaction.text : input.user;
      const piiRedacted = redaction ? totalRedactions(redaction.counts) : 0;
      const bytesSent =
        Buffer.byteLength(input.system) + Buffer.byteLength(user);
      if (bytesSent > MAX_PROMPT_BYTES)
        throw new ValidationError(
          `Dữ liệu gửi AI vượt trần ${MAX_PROMPT_BYTES} byte`,
        );
      const counts = { itemCount: input.itemCount, bytesSent };

      // Ngân sách TRƯỚC mọi thứ có thể gửi ra ngoài: 100% → chặn bằng mã lỗi; 80% → cảnh báo.
      const { ratio } = await usage(input.workspaceId, input.purpose);
      if (ratio >= 1) {
        await disclosure(input, model, counts, "blocked");
        if (log)
          logSecurityEvent(log, {
            event: "ai.budget_exceeded",
            outcome: "denied",
            actor: input.actorId,
            targetType: "workspace",
            targetId: input.workspaceId,
          });
        throw new AiBudgetError();
      }
      if (ratio >= BUDGET_WARN_RATIO)
        log?.warn("ai budget warning", {
          workspace_id: input.workspaceId,
          purpose: input.purpose,
          used_ratio: Math.round(ratio * 100) / 100,
        });

      if (!model.local) {
        const [w] = await db
          .select({ on: workspaces.aiCloudEnabled })
          .from(workspaces)
          .where(eq(workspaces.id, input.workspaceId));
        // Cờ chưa đủ: phải có bản ghi đồng ý đang hiệu lực (CMP-VN-001). Thiếu bản ghi hoặc đã rút = không gửi.
        const consented =
          w?.on === true &&
          (await currentConsent(db, input.workspaceId, "ai_cloud")).granted;
        if (!consented) {
          await disclosure(input, model, counts, "blocked");
          if (log)
            logSecurityEvent(log, {
              event: "ai.blocked",
              outcome: "denied",
              actor: input.actorId,
              targetType: "workspace",
              targetId: input.workspaceId,
            });
          throw new AiNotAllowedError();
        }
      }

      const [row] = await disclosure(input, model, counts, "sent");
      const id = row!.id;
      const started = Date.now();
      try {
        const {
          text,
          usage: tokens,
          responseModel,
          stopReason,
        } = await model.generate({
          system: input.system,
          user,
          maxOutputTokens: input.maxOutputTokens,
        });
        await db
          .update(aiDisclosures)
          .set({ status: "ok" })
          .where(eq(aiDisclosures.id, id));
        // Span dạng log có cấu trúc theo OTel GenAI (AI-OBS-001). TUYỆT ĐỐI không có prompt/completion (AI-OBS-004).
        log?.info("gen_ai.client.operation", {
          "gen_ai.provider.name": model.id,
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": model.model,
          "gen_ai.response.model": responseModel ?? model.model,
          "gen_ai.usage.input_tokens": tokens?.inputTokens ?? null,
          "gen_ai.usage.output_tokens": tokens?.outputTokens ?? null,
          "gen_ai.purpose": input.purpose,
          workspace_id: input.workspaceId,
          disclosure_id: id,
          duration_ms: Date.now() - started,
          // Chỉ số lượng, không có nội dung đã che (AI-GUARD-004).
          pii_redacted: piiRedacted,
          "gen_ai.response.finish_reason": stopReason ?? null,
        });
        if (tokens && metrics) {
          const base = {
            tenant: input.workspaceId,
            feature: input.purpose,
            model: model.model,
          };
          metrics.addLlmTokens({
            ...base,
            direction: "input",
            tokens: tokens.inputTokens,
          });
          metrics.addLlmTokens({
            ...base,
            direction: "output",
            tokens: tokens.outputTokens,
          });
        }
        return { text, disclosureId: id, stopReason };
      } catch (e) {
        const code =
          e instanceof ModelError && SAFE_CODE.test(e.code)
            ? e.code
            : "internal";
        await db
          .update(aiDisclosures)
          .set({ status: "error", errorCode: code })
          .where(eq(aiDisclosures.id, id));
        throw e;
      }
    },
  };
}

export type AiGateway = ReturnType<typeof createAiGateway>;
