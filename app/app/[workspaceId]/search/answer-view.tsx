import type { Citation } from "@/src/ai/answer";
import { AI_ANSWER_LABEL, SOURCE_LABEL } from "@/src/ai/labels";

/**
 * Hiển thị câu trả lời do AI tạo (UX-AI-002, UX-AI-007). Đầu ra mô hình là dữ liệu không tin cậy: chỉ đi vào cây React
 * dưới dạng văn bản (React tự escape), không đặt HTML thô vào trang, không biến thành liên kết hay nút — URL nếu
 * có (đã bị `checkOutput` giới hạn ở URL có trong nguồn) hiện nguyên văn, không bấm được.
 */
export function AnswerView({
  answer,
  citations,
}: {
  answer: string;
  citations: Citation[];
}) {
  return (
    <section
      aria-label="Câu trả lời"
      data-generated-by="ai"
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-medium text-muted-foreground">
        {AI_ANSWER_LABEL}
      </p>
      <p className="whitespace-pre-wrap break-words">{answer}</p>
      <ol className="flex flex-col gap-1 text-sm" aria-label="Nguồn trích dẫn">
        {citations.map((c) => (
          <li key={c.n}>
            [{c.n}] {SOURCE_LABEL[c.source] ?? c.source} · {c.externalId}
            {c.snippet && (
              <span className="text-muted-foreground"> — {c.snippet}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
