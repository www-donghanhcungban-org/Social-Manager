import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import {
  evidenceBlobs,
  evidenceItems,
  members,
  workspaces,
} from "@/src/db/schema";
import {
  createFsBlobStore,
  createMemoryBlobStore,
  type BlobStore,
} from "@/src/evidence/blob-store";
import {
  createEvidenceService,
  IntegrityError,
  MAX_EVIDENCE_BYTES,
} from "@/src/evidence/service";
import { ValidationError } from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

const sha = (s: string | Uint8Array) =>
  createHash("sha256")
    .update(typeof s === "string" ? Buffer.from(s.normalize("NFC")) : s)
    .digest("hex");
const AT = new Date("2026-11-22T08:00:00Z");

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: ReturnType<typeof createMemoryBlobStore>;
let wsA: string;
let wsB: string;

const svc = (s: BlobStore = store) =>
  createEvidenceService({ db: t.db, store: s });
const base = (over = {}) => ({
  workspaceId: wsA,
  source: "document" as const,
  externalId: "m1",
  content: "Còn hàng không?",
  contentType: "text/plain" as const,
  observedAt: AT,
  ...over,
});

beforeEach(async () => {
  t = await createTestDb();
  store = createMemoryBlobStore();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  wsA = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: wsA, userId: "admin", role: "admin" },
    { workspaceId: wsA, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
});
afterEach(async () => {
  await t.client.close();
});

describe("ingest", () => {
  it("lưu nội dung theo hash, trả lại nguyên văn kèm kiểm hash [F-007/AC-01]", async () => {
    const r = await svc().ingest({ actorId: "admin", ...base() });
    expect(r).toMatchObject({
      sha256: sha("Còn hàng không?"),
      blobReused: false,
      duplicate: false,
    });
    const got = await svc().getContent({
      actorId: "member",
      workspaceId: wsA,
      itemId: r.itemId,
    });
    expect(new TextDecoder().decode(got.content)).toBe("Còn hàng không?");
    expect(got.item).toMatchObject({
      source: "document",
      externalId: "m1",
      sizeBytes: Buffer.byteLength("Còn hàng không?"),
    });
  });

  it("cùng nội dung ở hai id ngoài: một blob, hai lần xuất hiện [F-007/AC-01]", async () => {
    const a = await svc().ingestAsSystem(base({ externalId: "m1" }));
    const b = await svc().ingestAsSystem(base({ externalId: "m2" }));
    expect(b.blobReused).toBe(true);
    expect(b.blobId).toBe(a.blobId);
    expect(b.itemId).not.toBe(a.itemId);
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(1);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(2);
    expect(store.size).toBe(1);
  });

  it("nhập lại cùng (nguồn, id ngoài, nội dung) là lũy đẳng [F-007/AC-02]", async () => {
    const a = await svc().ingestAsSystem(base());
    const b = await svc().ingestAsSystem(base());
    expect(b).toMatchObject({ itemId: a.itemId, duplicate: true });
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
  });

  it("cùng id ngoài mà nội dung đổi là phiên bản mới, bản cũ vẫn còn [F-007/AC-02]", async () => {
    const v1 = await svc().ingestAsSystem(base({ content: "bản 1" }));
    const v2 = await svc().ingestAsSystem(base({ content: "bản 2" }));
    expect(v2.blobId).not.toBe(v1.blobId);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(2);
    const old = await svc().getContent({
      actorId: "member",
      workspaceId: wsA,
      itemId: v1.itemId,
    });
    expect(new TextDecoder().decode(old.content)).toBe("bản 1");
  });

  it("chuẩn hoá NFC: dạng NFD và NFC cho cùng một hash [F-007/AC-02]", async () => {
    const nfd = "Việt".normalize("NFD");
    const a = await svc().ingestAsSystem(
      base({ externalId: "a", content: nfd }),
    );
    const b = await svc().ingestAsSystem(
      base({ externalId: "b", content: "Việt".normalize("NFC") }),
    );
    expect(a.sha256).toBe(b.sha256);
  });

  it("từ chối nội dung rỗng, quá trần, loại/nguồn lạ, id ngoài rỗng hoặc quá dài, ngày hỏng [F-007/AC-03]", async () => {
    const bad: Record<string, unknown>[] = [
      { content: "" },
      { content: new Uint8Array(0) },
      { content: new Uint8Array(MAX_EVIDENCE_BYTES + 1).fill(97) },
      { contentType: "application/x-msdownload" },
      { source: "ftp" },
      { source: "message" }, // thiếu messageId
      { externalId: "   " },
      { externalId: "x".repeat(501) },
      { observedAt: new Date("không phải ngày") },
    ];
    for (const over of bad)
      await expect(svc().ingestAsSystem(base(over))).rejects.toBeInstanceOf(
        ValidationError,
      );
    expect(await t.db.select().from(evidenceItems)).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("nhận đúng trần kích thước [F-007/AC-03]", async () => {
    const r = await svc().ingestAsSystem(
      base({ content: new Uint8Array(MAX_EVIDENCE_BYTES).fill(97) }),
    );
    expect(r.duplicate).toBe(false);
  });

  it("lỗi ghi kho nội dung: không để lại dòng DB nào [F-007/AC-03]", async () => {
    const broken: BlobStore = {
      ...store,
      put: async () => {
        throw new Error("đầy đĩa");
      },
    };
    await expect(svc(broken).ingestAsSystem(base())).rejects.toThrow("đầy đĩa");
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(0);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(0);
  });

  it("lỗi DB sau khi ghi tệp: không có dòng DB; tệp mồ côi không ai trỏ tới [F-007/AC-03]", async () => {
    await expect(
      svc().ingestAsSystem(
        base({ workspaceId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).rejects.toThrow();
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(0);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(0);
  });
});

describe("quyền và cô lập workspace", () => {
  it("member không nhập được, người ngoài bị Forbidden; admin nhập được [F-007/AC-09]", async () => {
    for (const actorId of ["member", "other", "không-ai"])
      await expect(svc().ingest({ actorId, ...base() })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    await expect(
      svc().ingest({ actorId: "admin", ...base() }),
    ).resolves.toBeDefined();
  });

  it("workspace khác không đọc được mục của mình dù biết id; cùng nội dung có blob riêng [F-007/AC-09]", async () => {
    const a = await svc().ingestAsSystem(base());
    await expect(
      svc().getContent({
        actorId: "other",
        workspaceId: wsB,
        itemId: a.itemId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().get({ actorId: "other", workspaceId: wsA, itemId: a.itemId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const b = await svc().ingestAsSystem(base({ workspaceId: wsB }));
    expect(b.blobId).not.toBe(a.blobId);
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(2);
  });

  it("id lạ là NotFound", async () => {
    await expect(
      svc().get({ actorId: "member", workspaceId: wsA, itemId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("xoá workspace xoá luôn blob và lần xuất hiện của nó", async () => {
    await svc().ingestAsSystem(base());
    await t.db.delete(workspaces).where(eq(workspaces.id, wsA));
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(0);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(0);
  });
});

describe("toàn vẹn", () => {
  it("nội dung bị sửa trong kho: IntegrityError, không trả nội dung sai [F-007/AC-03]", async () => {
    const r = await svc().ingestAsSystem(base());
    store.corrupt(r.sha256, new TextEncoder().encode("đã bị sửa"));
    await expect(
      svc().getContent({
        actorId: "member",
        workspaceId: wsA,
        itemId: r.itemId,
      }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });

  it("nội dung mất khỏi kho: NotFound [F-007/AC-03]", async () => {
    const r = await svc().ingestAsSystem(base());
    await store.delete(r.sha256);
    await expect(
      svc().getContent({
        actorId: "member",
        workspaceId: wsA,
        itemId: r.itemId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("CHECK của CSDL từ chối hash sai định dạng và kích thước 0", async () => {
    for (const row of [
      { sha256: "ABC", sizeBytes: 5 },
      { sha256: sha("x"), sizeBytes: 0 },
    ])
      await expect(
        t.db.insert(evidenceBlobs).values({
          workspaceId: wsA,
          contentType: "text/plain",
          ...row,
        }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("BlobStore thư mục", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xw-blob-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ghi theo <2 ký tự đầu>/<sha256>, đọc lại đúng, xoá được, đọc thiếu là null [F-007/AC-01]", async () => {
    const fs = createFsBlobStore(dir);
    const key = sha("xin chào");
    await fs.put(key, new TextEncoder().encode("xin chào"));
    expect(new TextDecoder().decode((await fs.get(key))!)).toBe("xin chào");
    expect(await readFile(join(dir, key.slice(0, 2), key), "utf8")).toBe(
      "xin chào",
    );
    await fs.put(key, new TextEncoder().encode("xin chào")); // lũy đẳng
    expect(await readdir(join(dir, key.slice(0, 2)))).toEqual([key]); // không để tệp tạm
    await fs.delete(key);
    expect(await fs.get(key)).toBeNull();
    await fs.delete(key); // xoá lần hai không lỗi
  });

  it("từ chối khoá không phải sha256 (chặn thoát thư mục)", async () => {
    const fs = createFsBlobStore(dir);
    for (const key of [
      "../etc/passwd",
      "a/b",
      "",
      "ABC",
      sha("x").toUpperCase(),
      `${sha("x")}/..`,
    ]) {
      await expect(fs.put(key, new Uint8Array([1]))).rejects.toThrow(
        /Khoá blob/,
      );
      await expect(fs.get(key)).rejects.toThrow(/Khoá blob/);
      await expect(fs.delete(key)).rejects.toThrow(/Khoá blob/);
    }
  });

  it("dịch vụ chạy được trên kho thư mục", async () => {
    const r = await svc(createFsBlobStore(dir)).ingestAsSystem(base());
    const got = await svc(createFsBlobStore(dir)).getContent({
      actorId: "member",
      workspaceId: wsA,
      itemId: r.itemId,
    });
    expect(new TextDecoder().decode(got.content)).toBe("Còn hàng không?");
  });
});
