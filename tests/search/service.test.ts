import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import {
  conversations,
  evidenceItems,
  members,
  messages,
  providerConnections,
  searchDocuments,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { createSearchService, snippetOf } from "@/src/search/service";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: ReturnType<typeof createMemoryBlobStore>;
let ws: string;
let wsB: string;
let evidence: ReturnType<typeof createEvidenceService>;
let search: ReturnType<typeof createSearchService>;
let knowledge: ReturnType<typeof createKnowledgeService>;
const A = { actorId: "admin" };
const at = (s: number) => new Date(Date.UTC(2026, 10, 22, 8, 0, s));

const doc = (
  ext: string,
  content: string,
  observedAt = at(0),
  workspaceId = ws,
) =>
  evidence.ingestAsSystem({
    workspaceId,
    source: "document",
    externalId: ext,
    content,
    contentType: "text/markdown",
    observedAt,
  });
const find = (query: string, over: Record<string, unknown> = {}) =>
  search.search({ ...A, workspaceId: ws, query, ...over });
const ids = async (query: string, over = {}) =>
  (await find(query, over)).map((h) => h.externalId);

beforeEach(async () => {
  t = await createTestDb();
  store = createMemoryBlobStore();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
  evidence = createEvidenceService({ db: t.db, store });
  search = createSearchService({ db: t.db, evidence });
  knowledge = createKnowledgeService({ db: t.db, evidence });
});
afterEach(async () => {
  await t.client.close();
});

describe("tìm kiếm có dấu và không dấu", () => {
  it("tìm không dấu trúng nội dung có dấu và ngược lại, không phân biệt hoa thường", async () => {
    await doc("a", "Khách đặt Cửa hàng Hoa vào thứ Sáu");
    for (const q of [
      "cua hang hoa",
      "CỬA HÀNG",
      "Cửa Hàng Hoa",
      "thu sau",
      "KHÁCH ĐẶT",
      "khach dat",
    ])
      expect(await ids(q), q).toEqual(["a"]);
    expect(await ids("cua hang xe")).toEqual([]);
  });

  it("chữ đ và Đ: tìm 'duong' ra 'Đường', 'đơn' ra 'don'", async () => {
    await doc("a", "Đường Đồng Khởi, đơn hàng số 5");
    expect(await ids("duong dong khoi")).toEqual(["a"]);
    expect(await ids("đơn hàng")).toEqual(["a"]);
    expect(await ids("DON HANG so 5")).toEqual(["a"]);
  });

  it("khớp tiền tố (gõ dở) và yêu cầu mọi từ cùng có mặt", async () => {
    await doc("a", "báo giá hoa hồng");
    await doc("b", "báo giá xe đạp");
    expect((await ids("bao gi")).sort()).toEqual(["a", "b"]);
    expect(await ids("bao gia hoa")).toEqual(["a"]);
    expect(await ids("hoa xe")).toEqual([]);
  });

  it("truy vấn rỗng, chỉ dấu câu, hoặc ký tự đặc biệt của tsquery không gây lỗi", async () => {
    await doc("a", "nội dung bình thường");
    for (const q of [
      "",
      "   ",
      "!!!",
      "&",
      "|",
      "!",
      ":*",
      "(",
      ")",
      "a & b",
      "'; drop table x; --",
      "<->",
      "\\",
      "x:*y",
    ])
      await expect(find(q), q).resolves.toBeDefined();
    expect(await ids("")).toEqual([]);
    expect(await ids("!!!")).toEqual([]);
  });

  it("xếp hạng: nội dung khớp nhiều hơn lên trước; đồng điểm thì mới hơn trước", async () => {
    await doc("it", "hoa hoa hoa hoa hồng", at(1));
    await doc("old", "hoa", at(2));
    await doc("new", "hoa", at(3));
    const r = await ids("hoa");
    expect(r[0]).toBe("it");
    expect(r.indexOf("new")).toBeLessThan(r.indexOf("old"));
  });

  it("limit bị kẹp 1..50", async () => {
    for (let i = 0; i < 3; i++) await doc(`d${i}`, `hoa ${i}`);
    expect(await ids("hoa", { limit: 0 })).toHaveLength(1);
    expect(await ids("hoa", { limit: 2 })).toHaveLength(2);
    expect(await ids("hoa", { limit: 9999 })).toHaveLength(3);
  });
});

describe("đoạn trích và phiên bản", () => {
  it("đoạn trích lấy từ nguyên văn (có dấu) quanh chỗ khớp", async () => {
    const long = `${"mở đầu dài ".repeat(30)}Cửa hàng Hoa chốt giá ${"kết thúc dài ".repeat(30)}`;
    await doc("a", long);
    const [hit] = await find("cua hang hoa");
    expect(hit!.snippet).toContain("Cửa hàng Hoa chốt giá");
    expect(hit!.snippet!.startsWith("…")).toBe(true);
    expect(hit!.snippet!.endsWith("…")).toBe(true);
    expect(hit!.snippet!.length).toBeLessThan(200);
  });

  it("snippetOf giữ đúng vị trí với dạng NFD và emoji", () => {
    const s = `😀 ${"x ".repeat(100)}Việt Nam`.normalize("NFD");
    expect(snippetOf(s, ["viet"])).toContain("Việt Nam");
  });

  it("mặc định chỉ trả phiên bản mới nhất của một mục; phiên bản cũ chỉ khi allVersions", async () => {
    await doc("x", "giá cũ là 100");
    await doc("x", "giá mới là 200");
    expect(await ids("gia cu")).toEqual([]); // bản cũ bị bản mới thay thế
    expect(await ids("gia moi")).toEqual(["x"]);
    expect(await ids("gia cu", { allVersions: true })).toEqual(["x"]);
  });

  it("nội dung hỏng trong kho vẫn ra kết quả nhưng không có đoạn trích", async () => {
    const r = await doc("a", "chuyện cũ");
    store.corrupt(r.sha256, new TextEncoder().encode("bị sửa"));
    const [hit] = await find("chuyen cu");
    expect(hit!.externalId).toBe("a");
    expect(hit!.snippet).toBeNull();
  });
});

describe("phạm vi và quyền", () => {
  it("không thấy mục của workspace khác; người ngoài và id lạ bị chặn", async () => {
    await doc("a", "bí mật của A");
    await doc("b", "bí mật của B", at(0), wsB);
    expect(await ids("bi mat")).toEqual(["a"]);
    expect(
      (
        await search.search({
          actorId: "other",
          workspaceId: wsB,
          query: "bi mat",
        })
      ).map((h) => h.externalId),
    ).toEqual(["b"]);
    await expect(
      search.search({ actorId: "other", workspaceId: ws, query: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(find("x", { projectId: "lạ" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("member tìm được (chỉ đọc)", async () => {
    await doc("a", "tài liệu");
    await expect(
      search.search({ actorId: "member", workspaceId: ws, query: "tai lieu" }),
    ).resolves.toHaveLength(1);
  });

  it("lọc theo dự án: gắn trực tiếp hoặc qua hội thoại; dự án khác không lẫn", async () => {
    const p1 = await knowledge.createProject({
      ...A,
      workspaceId: ws,
      name: "P1",
    });
    const p2 = await knowledge.createProject({
      ...A,
      workspaceId: ws,
      name: "P2",
    });
    const direct = await doc("direct", "báo giá hoa");
    await doc("other", "báo giá hoa");
    await knowledge.link({
      ...A,
      workspaceId: ws,
      projectId: p1.id,
      target: { type: "evidence", evidenceItemId: direct.itemId },
    });
    const [c] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId: ws,
        provider: "demo",
        label: "c",
        credentialsEnc: "v1:x",
      })
      .returning();
    const [acc] = await t.db
      .insert(socialAccounts)
      .values({
        connectionId: c!.id,
        platform: "facebook",
        externalId: "p",
        displayName: "P",
      })
      .returning();
    const [conv] = await t.db
      .insert(conversations)
      .values({
        workspaceId: ws,
        socialAccountId: acc!.id,
        externalId: "c1",
        participantId: "u",
        participantName: "Lan",
      })
      .returning();
    await t.db.insert(messages).values({
      workspaceId: ws,
      conversationId: conv!.id,
      socialAccountId: acc!.id,
      externalId: "m1",
      direction: "incoming",
      author: "Lan",
      text: "hỏi báo giá hoa",
      sentAt: at(5),
    });
    await evidence.backfillMessages({ workspaceId: ws });
    await knowledge.link({
      ...A,
      workspaceId: ws,
      projectId: p1.id,
      target: { type: "conversation", conversationId: conv!.id },
    });
    const inP1 = await ids("bao gia hoa", { projectId: p1.id });
    expect(inP1).toHaveLength(2);
    expect(inP1).toContain("direct");
    expect(await ids("bao gia hoa", { projectId: p2.id })).toEqual([]);
    expect(await ids("bao gia hoa")).toHaveLength(3);
  });

  it("xoá bằng chứng thì biến khỏi kết quả (cascade chỉ mục)", async () => {
    const r = await doc("a", "sắp bị xoá");
    expect(await ids("sap bi xoa")).toEqual(["a"]);
    await t.db.delete(evidenceItems).where(eq(evidenceItems.id, r.itemId));
    expect(await ids("sap bi xoa")).toEqual([]);
    expect(await t.db.select().from(searchDocuments)).toHaveLength(0);
  });
});

describe("chỉ mục", () => {
  it("nhập bằng chứng ghi chỉ mục cùng giao dịch; lũy đẳng khi nhập lại", async () => {
    await doc("a", "nội dung");
    await doc("a", "nội dung");
    expect(await t.db.select().from(searchDocuments)).toHaveLength(1);
  });

  it("reindexMissing dựng chỉ mục cho bằng chứng chưa có, lũy đẳng, báo còn", async () => {
    for (const x of ["a", "b", "c"]) await doc(x, `tài liệu ${x}`);
    await t.db.delete(searchDocuments);
    expect(await ids("tai lieu")).toEqual([]);
    const readRaw = async (itemId: string) =>
      (await evidence.getContent({ ...A, workspaceId: ws, itemId })).content;
    expect(
      await search.reindexMissing({ workspaceId: ws, limit: 2, readRaw }),
    ).toEqual({ indexed: 2, more: true });
    expect(
      await search.reindexMissing({ workspaceId: ws, limit: 2, readRaw }),
    ).toEqual({ indexed: 1, more: false });
    expect(await ids("tai lieu")).toHaveLength(3);
    expect(await search.reindexMissing({ workspaceId: ws, readRaw })).toEqual({
      indexed: 0,
      more: false,
    });
  });
});
