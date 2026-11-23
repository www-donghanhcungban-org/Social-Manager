import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { members, workspaces } from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { createSearchService } from "@/src/search/service";

import { createTestDb } from "../db/helpers";

interface QaFile {
  version: number;
  thresholds: {
    answerable_recall_at_5: number;
    unanswerable_empty: number;
    scoped_precision: number;
  };
  corpus: { id: string; project: string | null; content: string }[];
  questions: {
    id: string;
    kind: "answerable" | "unanswerable" | "scoped";
    diacritics: boolean;
    question: string;
    project?: string;
    expect: string[];
  }[];
}

const RAW = readFileSync("docs/eval/qa-v1.json", "utf-8");
const qa = JSON.parse(RAW) as QaFile;
const LOCK = readFileSync("docs/eval/qa-v1.lock", "utf-8");
const A = { actorId: "admin" };

describe("bộ đánh giá qa-v1: toàn vẹn và phiên bản", () => {
  it("khớp khoá băm: đổi câu hỏi/kho giả/ngưỡng phải cập nhật qa-v1.lock kèm lý do (không lặng lẽ nới)", () => {
    const sha = createHash("sha256").update(RAW).digest("hex");
    expect(LOCK).toContain(`sha256: ${sha}`);
    expect(LOCK).toMatch(/^reason: .{10,}$/m);
  });

  it("đúng 50 câu, id duy nhất, đủ ba loại, đủ có dấu và không dấu", () => {
    expect(qa.version).toBe(1);
    expect(qa.questions).toHaveLength(50);
    expect(new Set(qa.questions.map((q) => q.id)).size).toBe(50);
    const count = (k: string) =>
      qa.questions.filter((q) => q.kind === k).length;
    expect([
      count("answerable"),
      count("unanswerable"),
      count("scoped"),
    ]).toEqual([40, 6, 4]);
    const ans = qa.questions.filter((q) => q.kind === "answerable");
    expect(ans.filter((q) => q.diacritics)).toHaveLength(20);
    expect(ans.filter((q) => !q.diacritics)).toHaveLength(20);
    // cờ `diacritics` đúng với nội dung câu hỏi
    for (const q of qa.questions)
      expect(/[^\x00-\x7f]/.test(q.question), q.id).toBe(q.diacritics);
  });

  it("mọi đáp án trỏ tới tài liệu có thật; ngưỡng hợp lý", () => {
    const ids = new Set(qa.corpus.map((c) => c.id));
    expect(ids.size).toBe(qa.corpus.length);
    for (const q of qa.questions)
      for (const e of q.expect) expect(ids.has(e), q.id).toBe(true);
    expect(qa.thresholds.answerable_recall_at_5).toBeGreaterThanOrEqual(0.9);
    expect(qa.thresholds.unanswerable_empty).toBe(1);
    expect(qa.thresholds.scoped_precision).toBe(1);
  });
});

describe("truy xuất trên bộ qa-v1 (recall@5)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let ws: string;
  let search: ReturnType<typeof createSearchService>;
  const itemToDoc = new Map<string, string>();
  const projectIds = new Map<string, string>();
  const failures: string[] = [];

  beforeAll(async () => {
    t = await createTestDb();
    const [w] = await t.db
      .insert(workspaces)
      .values({ name: "Eval" })
      .returning();
    ws = w!.id;
    await t.db
      .insert(members)
      .values({ workspaceId: ws, userId: "admin", role: "admin" });
    const evidence = createEvidenceService({
      db: t.db,
      store: createMemoryBlobStore(),
    });
    const knowledge = createKnowledgeService({ db: t.db, evidence });
    search = createSearchService({ db: t.db, evidence });
    for (const name of new Set(
      qa.corpus.map((c) => c.project).filter((p): p is string => p !== null),
    )) {
      const p = await knowledge.createProject({ ...A, workspaceId: ws, name });
      projectIds.set(name, p.id);
    }
    for (const c of qa.corpus) {
      const r = await evidence.ingestAsSystem({
        workspaceId: ws,
        source: "document",
        externalId: c.id,
        content: c.content,
        contentType: "text/markdown",
        observedAt: new Date("2026-11-22T08:00:00Z"),
      });
      itemToDoc.set(r.itemId, c.id);
      if (c.project)
        await knowledge.link({
          ...A,
          workspaceId: ws,
          projectId: projectIds.get(c.project)!,
          target: { type: "evidence", evidenceItemId: r.itemId },
        });
    }
  });
  afterAll(async () => {
    await t.client.close();
  });

  const run = async (q: QaFile["questions"][number]) =>
    (
      await search.search({
        ...A,
        workspaceId: ws,
        query: q.question,
        limit: 5,
        match: "any",
        projectId: q.project ? projectIds.get(q.project) : undefined,
      })
    ).map((h) => itemToDoc.get(h.itemId)!);

  it("câu có đáp án: recall@5 đạt ngưỡng, cả có dấu lẫn không dấu", async () => {
    const byGroup = { true: [0, 0], false: [0, 0] } as Record<string, number[]>;
    for (const q of qa.questions.filter((x) => x.kind === "answerable")) {
      const got = await run(q);
      const hit = q.expect.some((e) => got.includes(e));
      byGroup[String(q.diacritics)]![0]! += hit ? 1 : 0;
      byGroup[String(q.diacritics)]![1]! += 1;
      if (!hit)
        failures.push(
          `${q.id} «${q.question}» kỳ vọng ${q.expect} nhận ${got}`,
        );
    }
    const total = byGroup.true![0]! + byGroup.false![0]!;
    const recall = total / 40;
    expect(
      recall,
      `recall@5 = ${recall.toFixed(3)}; trượt: ${failures.join(" | ")}`,
    ).toBeGreaterThanOrEqual(qa.thresholds.answerable_recall_at_5);
    // không để một nhóm tụt riêng: nhóm không dấu và có dấu mỗi nhóm cũng ≥ ngưỡng
    expect(byGroup.true![0]! / 20).toBeGreaterThanOrEqual(
      qa.thresholds.answerable_recall_at_5,
    );
    expect(byGroup.false![0]! / 20).toBeGreaterThanOrEqual(
      qa.thresholds.answerable_recall_at_5,
    );
  });

  it("câu không có đáp án: truy xuất trả rỗng (không bịa nguồn)", async () => {
    const qs = qa.questions.filter((x) => x.kind === "unanswerable");
    let empty = 0;
    for (const q of qs) if ((await run(q)).length === 0) empty++;
    expect(empty / qs.length).toBeGreaterThanOrEqual(
      qa.thresholds.unanswerable_empty,
    );
  });

  it("cùng từ ở hai dự án: lọc theo dự án chỉ ra tài liệu của dự án đó và có đáp án đúng", async () => {
    const qs = qa.questions.filter((x) => x.kind === "scoped");
    let ok = 0;
    for (const q of qs) {
      const got = await run(q);
      const inProject = qa.corpus
        .filter((c) => c.project === q.project)
        .map((c) => c.id);
      if (
        got.length > 0 &&
        got.every((g) => inProject.includes(g)) &&
        q.expect.every((e) => got.includes(e))
      )
        ok++;
    }
    expect(ok / qs.length).toBeGreaterThanOrEqual(
      qa.thresholds.scoped_precision,
    );
  });
});
