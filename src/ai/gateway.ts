import { eq } from "drizzle-orm";

import { requireAction } from "../auth/access";
import type { Db } from "../auth/members";
import { aiDisclosures, workspaces } from "../db/schema";
import { ValidationError } from "../providers/types";
import {
  AiDisabledError,
  AiNotAllowedError,
  ModelError,
  type ModelPort,
} from "./port";

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
export function createAiGateway({
  db,
  model,
}: {
  db: Db;
  /** null = AI tắt. */
  model: ModelPort | null;
}) {
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
    }): Promise<{ text: string; disclosureId: string }> {
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
      const bytesSent =
        Buffer.byteLength(input.system) + Buffer.byteLength(input.user);
      if (bytesSent > MAX_PROMPT_BYTES)
        throw new ValidationError(
          `Dữ liệu gửi AI vượt trần ${MAX_PROMPT_BYTES} byte`,
        );
      const counts = { itemCount: input.itemCount, bytesSent };

      if (!model.local) {
        const [w] = await db
          .select({ on: workspaces.aiCloudEnabled })
          .from(workspaces)
          .where(eq(workspaces.id, input.workspaceId));
        if (!w?.on) {
          await disclosure(input, model, counts, "blocked");
          throw new AiNotAllowedError();
        }
      }

      const [row] = await disclosure(input, model, counts, "sent");
      const id = row!.id;
      try {
        const { text } = await model.generate({
          system: input.system,
          user: input.user,
          maxOutputTokens: input.maxOutputTokens,
        });
        await db
          .update(aiDisclosures)
          .set({ status: "ok" })
          .where(eq(aiDisclosures.id, id));
        return { text, disclosureId: id };
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
