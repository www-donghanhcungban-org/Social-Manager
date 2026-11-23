import { handleError } from "@/src/http/errors";
import { MAX_WEBHOOK_BYTES } from "@/src/inbox/webhook";
import { defaultLogger } from "@/src/log/process";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/src/providers/socialapi";
import { getContainer } from "@/src/server/runtime";

/**
 * Webhook SocialAPI cho một kết nối. Không dùng phiên đăng nhập: xác thực bằng chữ ký HMAC (xem
 * `src/inbox/webhook.ts`). Phải đọc BYTE THÔ vì chữ ký tính trên thân gốc, không phải JSON đã dựng lại.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES)
    return Response.json({ status: "too_large" }, { status: 413 });

  try {
    const { connectionId } = await ctx.params;
    const rawBody = Buffer.from(await req.arrayBuffer());
    const { status, body } = await getContainer().services.webhooks.handle({
      connectionId,
      rawBody,
      timestamp: req.headers.get(TIMESTAMP_HEADER),
      signature: req.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(body, { status });
  } catch (error) {
    // Lỗi CSDL/bất ngờ: 500 chung để SocialAPI thử lại theo lịch của họ (tối đa 10 lần).
    const { status, body } = handleError(error, {
      log: defaultLogger(),
      requestId: crypto.randomUUID(),
    });
    return Response.json(body, { status });
  }
}
