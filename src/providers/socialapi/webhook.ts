import { createHmac, timingSafeEqual } from "node:crypto";

import { parseIsoWithOffset } from "../actions";
import { ValidationError, type InboxKind } from "../types";

/**
 * Webhook SocialAPI. Nguồn: https://docs.social-api.ai/guides/webhooks.md và webhook-events.md (đọc ngày
 * 2026-11-22). Dùng header V2: HMAC-SHA256 hex có tiền tố `sha256=` của `<timestamp>.<thân thô>`, khoá là
 * secret của endpoint; timestamp (giây) lệch quá 5 phút thì từ chối. Header V1 (không kiểm thời gian) bị bỏ.
 */
export const SIGNATURE_HEADER = "x-socialapi-signature-v2";
export const TIMESTAMP_HEADER = "x-socialapi-timestamp";
const TOLERANCE_SECONDS = 300;
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const TIMESTAMP = /^\d{1,12}$/;
const MAX_TEXT = 10_000;
const MAX_AUTHOR = 200;
const MAX_ID = 200;

export function verifyWebhookSignature(input: {
  secret: string;
  rawBody: Buffer;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  nowMs: number;
}): boolean {
  const { secret, rawBody, timestamp, signature, nowMs } = input;
  if (!secret || !timestamp || !signature) return false;
  if (!TIMESTAMP.test(timestamp)) return false;
  const sig = SIGNATURE.exec(signature);
  if (!sig) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  // Cả hai đều 32 byte (đã kiểm định dạng), nên timingSafeEqual không ném lỗi độ dài.
  return timingSafeEqual(expected, Buffer.from(sig[1]!, "hex"));
}

export type WebhookEvent =
  | { type: "ignored" }
  | {
      type: "inbox";
      kind: InboxKind;
      /** `data.account_id` của SocialAPI; app giả định trùng `social_accounts.external_id`. */
      accountExternalId: string;
      item: {
        externalId: string;
        author: string;
        text: string;
        receivedAt: Date;
      };
      /**
       * Chỉ với `dm.received` có `conversation_id` (Zalo không gửi): tin ghi vào hội thoại cùng khoá với đồng bộ
       * (ADR-0002, H1). Mục hộp thư khi đó khoá theo id hội thoại thay cho `data.id`.
       */
      message?: {
        conversationId: string;
        /** `platform_id` nếu có, không thì `data.id` (định danh yếu). */
        messageId: string;
        identityWeak: boolean;
        providerMessageId: string;
        participantId: string;
        /** Nguyên văn, không cắt. */
        text: string;
      };
    };

const KIND_OF_EVENT = new Map<string, InboxKind>([
  ["comment.received", "comment"],
  ["dm.received", "dm"],
  ["mention.received", "mention"],
  ["review.received", "review"],
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const bad = (what: string) =>
  new ValidationError(`Webhook không hợp lệ: ${what}`);

function str(v: unknown, what: string, max = MAX_ID): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max)
    throw bad(what);
  return v;
}

function isoDate(v: unknown, what: string): Date {
  const ms = typeof v === "string" ? parseIsoWithOffset(v) : undefined;
  if (ms === undefined) throw bad(what);
  return new Date(ms);
}

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.normalize("NFC").slice(0, max) : "";

/** Chuyển JSON đã giải mã thành sự kiện app hiểu; sự kiện không thuộc hộp thư thì bỏ qua, dữ liệu hỏng thì ném lỗi. */
export function parseWebhookEvent(json: unknown): WebhookEvent {
  if (!isRecord(json)) throw bad("không phải đối tượng");
  const kind =
    typeof json.event === "string" ? KIND_OF_EVENT.get(json.event) : undefined;
  if (kind === undefined) return { type: "ignored" };
  const data = json.data;
  if (!isRecord(data)) throw bad("thiếu data");
  const accountExternalId = str(data.account_id, "account_id");

  if (kind === "review") {
    const review = data.review;
    if (!isRecord(review)) throw bad("thiếu review");
    const author = isRecord(review.author) ? review.author : {};
    return {
      type: "inbox",
      kind,
      accountExternalId,
      item: {
        externalId: str(review.id, "review.id"),
        author: clean(author.name, MAX_AUTHOR).trim(),
        text: clean(review.text, MAX_TEXT),
        receivedAt: isoDate(review.created_at, "review.created_at"),
      },
    };
  }

  const author = data.author;
  if (!isRecord(author)) throw bad("thiếu author");
  const content = isRecord(data.content) ? data.content : {};
  const name =
    typeof author.name === "string" && author.name.trim() !== ""
      ? author.name
      : typeof author.id === "string"
        ? author.id
        : "";
  const id = str(data.id, "data.id");
  const item = {
    externalId: id,
    author: clean(name, MAX_AUTHOR).trim(),
    text: clean(content.text, MAX_TEXT),
    receivedAt: isoDate(data.received_at, "received_at"),
  };
  if (kind !== "dm" || data.conversation_id == null)
    return { type: "inbox", kind, accountExternalId, item };

  const conversationId = str(data.conversation_id, "conversation_id");
  const platformId =
    data.platform_id == null ? null : str(data.platform_id, "platform_id");
  return {
    type: "inbox",
    kind,
    accountExternalId,
    item: { ...item, externalId: conversationId },
    message: {
      conversationId,
      messageId: platformId ?? id,
      identityWeak: platformId === null,
      providerMessageId: id,
      participantId:
        typeof author.id === "string" && author.id !== ""
          ? author.id.slice(0, MAX_ID)
          : item.author,
      text: clean(content.text, Number.MAX_SAFE_INTEGER),
    },
  };
}
