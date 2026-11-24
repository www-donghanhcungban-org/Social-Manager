import { fold } from "../search/fold";

/**
 * Tầng kiểm TẤT ĐỊNH quanh mô hình (AI-GUARD-001/005/008): chạy ở server TRƯỚC mọi lời gọi mô hình, không có tham số
 * tắt, không phụ thuộc mô hình. Cấu hình guardrail nằm ở mã này nên đổi phải qua PR/review (cổng cấu hình).
 * Hàm thuần: không I/O.
 *
 * Phạm vi cố ý hẹp: chặn các mẫu rõ ràng (đổi luật, lộ lời nhắc, ký tự điều khiển) và chuyển người cho nhóm nhạy cảm.
 * Không thay cho ranh giới dữ liệu và việc mô hình không có công cụ (AI-APP-007).
 */
export type InputVerdict =
  { ok: true } | { ok: false; reason: "blocked_input" | "human_required" };

/** Mẫu cố gắng đổi luật hoặc moi lời nhắc; so trên văn bản đã bỏ dấu, chữ thường (`fold`). */
const INJECTION: RegExp[] = [
  // Cần cả đối tượng (hướng dẫn/luật) và cụm định vị ("trước đó", "hệ thống"): "bỏ qua hướng dẫn bảo quản" vẫn hợp lệ.
  /\b(bo qua|lo di|quen)\b[^.?!]{0,25}\b(huong dan|chi dan|chi thi|quy tac|luat)\b[^.?!]{0,25}\b(truoc do|truoc day|o tren|phia tren|ban dau|he thong|cua ban|da cho)\b/,
  /\bignore\b.{0,20}\b(previous|prior|above|all|your)\b.{0,20}\b(instructions?|rules?|prompt)\b/,
  /\b(tiet lo|in ra|cho xem|show|reveal|print)\b.{0,25}\b(loi nhac|system prompt|prompt he thong|chi dan he thong)\b/,
  /\b(developer mode|jailbreak|dan mode)\b/,
  /\b(ban la|you are now)\b.{0,20}\b(khong gioi han|no restrictions|unrestricted)\b/,
];

/**
 * Hành vi bị cấm (CMP-AI-002): yêu cầu thao túng/lừa dối, chấm điểm xã hội, nhận diện cảm xúc, deepfake, giả danh người,
 * che giấu giám sát của người. Hỏi đáp chỉ đọc kho bằng chứng nên không có tính năng nào làm việc này; mẫu dưới đây
 * từ chối sớm cả yêu cầu. Khớp trên văn bản đã bỏ dấu.
 */
const PROHIBITED: RegExp[] = [
  /\b(cham diem|xep hang|danh gia)\b.{0,20}\b(xa hoi|cong dan|uy tin cua nguoi)\b/,
  /\b(nhan dien|phan tich|doan)\b.{0,15}\bcam xuc\b/,
  /\b(deepfake|gia mao (giong|guong mat|khuon mat|hinh anh))\b/,
  /\b(thao tung|lua doi|danh lua)\b.{0,25}\b(khach hang|nguoi dung|nguoi gia|tre em|nguoi khuyet tat)\b/,
  /\b(gia (lam|danh) (nguoi that|nhan vien|con nguoi)|khong cho (ai|nguoi) biet (la )?(ai|bot|may))\b/,
  /\b(che giau|giau)\b.{0,20}\b(giam sat|kiem duyet cua con nguoi|nguoi duyet)\b/,
  /\b(social scoring|emotion recognition|impersonate a human)\b/,
];

/**
 * Nhóm rủi ro cao theo AI-GUARD-008: mô hình không tự xử, chuyển người. Cụm từ khớp trên văn bản đã bỏ dấu.
 * (Tiền/giao dịch của người dùng đi qua sổ hành động và duyệt của người, không qua hỏi đáp.)
 */
const SENSITIVE: { topic: string; re: RegExp }[] = [
  {
    topic: "y tế",
    re: /\b(chan doan|ke don|lieu thuoc|trieu chung|dieu tri benh|thuoc dieu tri)\b/,
  },
  {
    topic: "pháp lý",
    re: /\b(khoi kien|tranh chap|luat su|ra toa|boi thuong phap ly|vi pham phap luat)\b/,
  },
  {
    topic: "tài chính cá nhân",
    re: /\b(khuyen dau tu|vay nong|cho vay|chung khoan|tien ao|lai suat vay)\b/,
  },
  {
    topic: "trẻ em",
    re: /\b(tre em|tre vi thanh nien|duoi 16 tuoi|duoi 18 tuoi)\b/,
  },
];

/** Tự hại: so trên bản CÓ dấu, vì bỏ dấu thì "tự tử" trùng "từ từ". Gõ không dấu thì không bắt (chấp nhận, ghi ở test). */
const SELF_HARM = /(tự tử|tự hại|tự sát|không muốn sống)/;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function checkInput(question: string): InputVerdict {
  if (CONTROL.test(question)) return { ok: false, reason: "blocked_input" };
  const f = fold(question);
  if (INJECTION.some((re) => re.test(f)) || PROHIBITED.some((re) => re.test(f)))
    return { ok: false, reason: "blocked_input" };
  if (sensitiveTopics(question).length > 0)
    return { ok: false, reason: "human_required" };
  return { ok: true };
}

/** Nhóm nhạy cảm khớp (cho test/ghi chú); rỗng nếu không có. */
export function sensitiveTopics(question: string): string[] {
  const f = fold(question);
  const topics = SENSITIVE.filter((s) => s.re.test(f)).map((s) => s.topic);
  if (SELF_HARM.test(question.normalize("NFC").toLowerCase()))
    topics.push("an toàn cá nhân");
  return topics;
}

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;
export const MAX_ANSWER_CHARS = 4000;

/**
 * Kiểm đầu ra trước khi hiển thị: không thẻ HTML/script, không ký tự điều khiển, không ảnh/đường dẫn markdown dẫn ra
 * ngoài, không URL nào không có trong nguồn đã đưa vào (chặn rò dữ liệu qua URL do mô hình bịa).
 */
export function checkOutput(answer: string, sourceTexts: string[]): boolean {
  if (answer.length === 0 || answer.length > MAX_ANSWER_CHARS) return false;
  if (CONTROL.test(answer)) return false;
  if (/<\s*\/?\s*[a-z!]/i.test(answer)) return false;
  if (/!\[[^\]]*\]\(/.test(answer)) return false;
  for (const url of answer.match(URL_RE) ?? [])
    if (!sourceTexts.some((t) => t.includes(url))) return false;
  return true;
}
