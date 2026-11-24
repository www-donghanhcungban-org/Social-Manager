import { readdirSync, readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workspaces } from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";

import { createTestDb } from "../db/helpers";

/**
 * DB-SEARCH-004: truy vấn FTS dùng chỉ mục GIN trên đúng biểu thức `to_tsvector('simple', text_folded)` — không tính
 * lại vector cho từng dòng. Dự án dùng chỉ mục biểu thức (không cột `tsvector` lưu sẵn): cùng kết quả, một nguồn sự
 * thật là `text_folded`, không thêm cột phải đồng bộ.
 */
describe("tìm kiếm toàn văn dùng chỉ mục GIN (DB-SEARCH-004)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ws: string;

  beforeAll(async () => {
    t = await createTestDb();
    const [w] = await t.db
      .insert(workspaces)
      .values({ name: "Explain" })
      .returning();
    ws = w!.id;
    const evidence = createEvidenceService({
      db: t.db,
      store: createMemoryBlobStore(),
    });
    for (let i = 0; i < 40; i++)
      await evidence.ingestAsSystem({
        workspaceId: ws,
        source: "document",
        externalId: `d${i}`,
        content: i === 7 ? "bao quan hoa tuoi" : `tai lieu so ${i}`,
        contentType: "text/plain",
        observedAt: new Date("2026-11-22T08:00:00Z"),
      });
    await t.client.exec("ANALYZE search_documents");
  });
  afterAll(async () => {
    await t.client.close();
  });

  it("migration tạo chỉ mục GIN trên biểu thức to_tsvector('simple', text_folded)", () => {
    const sql = readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
      .map((f) => readFileSync(`drizzle/${f}`, "utf-8"))
      .join("\n");
    expect(sql).toMatch(
      /CREATE INDEX "search_documents_fts_idx" ON "search_documents" USING gin \(to_tsvector\('simple', "text_folded"\)\)/,
    );
  });

  it("EXPLAIN của truy vấn tìm kiếm dùng Bitmap Index Scan trên search_documents_fts_idx", async () => {
    // Bảng thử nhỏ nên bộ lập kế hoạch thích quét tuần tự; tắt nó để chứng minh chỉ mục dùng được cho đúng biểu thức.
    await t.client.exec("SET enable_seqscan = off");
    const r = await t.client.query<{ "QUERY PLAN": string }>(
      // Chỉ vị từ toàn văn: dịch vụ còn lọc workspace_id, và khi chỉ có một workspace thì bộ lập kế hoạch chọn chỉ mục
      // workspace cho điều kiện đó — không phải lỗi, nên kiểm riêng khả năng dùng chỉ mục FTS ở đây.
      `EXPLAIN SELECT id FROM search_documents
       WHERE to_tsvector('simple', text_folded) @@ to_tsquery('simple', 'hoa:*')`,
    );
    const plan = r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Bitmap Index Scan on search_documents_fts_idx/);
    await t.client.exec("RESET enable_seqscan");
  });

  it("dịch vụ tìm kiếm dùng cùng biểu thức với chỉ mục (không biểu thức khác làm chỉ mục vô dụng)", () => {
    const src = readFileSync("src/search/service.ts", "utf-8");
    expect(src).toContain(
      "to_tsvector('simple', ${searchDocuments.textFolded})",
    );
  });
});
