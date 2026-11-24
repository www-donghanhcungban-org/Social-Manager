import { AI_DISCLOSURE, SOURCE_LABEL } from "@/src/ai/labels";
import { formatDate } from "@/src/format/intl";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { AskForm } from "./ask-form";

export const metadata = { title: "Tìm kiếm — X-Workspace" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { user } = await requireWorkspace(workspaceId);
  const { search, ai } = getContainer().services;

  // Đầu vào của người dùng: chỉ nhận hai chế độ đã biết, độ dài bị chặn.
  const q = (one(sp.q) ?? "").slice(0, 200);
  const match = one(sp.match) === "any" ? "any" : "all";
  const hits =
    q.trim() === ""
      ? []
      : await search.search({
          actorId: user.id,
          workspaceId,
          query: q,
          match,
          limit: 20,
        });

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Tìm kiếm và hỏi đáp</h1>

      <section aria-labelledby="search-title" className="flex flex-col gap-3">
        <h2 id="search-title" className="text-lg font-medium">
          Tìm trong kho bằng chứng
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="q">Từ khoá</label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              maxLength={200}
              className="rounded border border-border p-2"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="match">Khớp</label>
            <select
              id="match"
              name="match"
              defaultValue={match}
              className="rounded border border-border p-2"
            >
              <option value="all">Mọi từ</option>
              <option value="any">Một trong các từ</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded border border-border px-3 py-1"
          >
            Tìm
          </button>
        </form>
        {q.trim() !== "" &&
          (hits.length === 0 ? (
            <p className="text-muted-foreground">Không có kết quả.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Kết quả tìm kiếm">
              {hits.map((h) => (
                <li key={h.itemId} className="rounded border border-border p-3">
                  <div className="text-sm text-muted-foreground">
                    {SOURCE_LABEL[h.source]} · {h.externalId} ·{" "}
                    <time dateTime={h.observedAt.toISOString()}>
                      {formatDate(h.observedAt)}
                    </time>
                  </div>
                  {/* Trích đoạn từ nội dung bên ngoài: văn bản thuần. */}
                  {h.snippet && (
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {h.snippet}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section aria-labelledby="ask-title" className="flex flex-col gap-3">
        <h2 id="ask-title" className="text-lg font-medium">
          Hỏi đáp có trích dẫn
        </h2>
        <p
          data-ai-disclosure
          className="rounded border border-border p-3 text-sm"
        >
          {AI_DISCLOSURE}
        </p>
        {ai.enabled ? (
          <AskForm workspaceId={workspaceId} />
        ) : (
          <p role="note" className="rounded border border-border p-3">
            AI chưa được bật trên máy chủ này nên chưa hỏi đáp được; tìm kiếm ở
            trên vẫn dùng bình thường.
          </p>
        )}
      </section>
    </main>
  );
}
