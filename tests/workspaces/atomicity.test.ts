import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { members, workspaces } from "@/src/db/schema";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

/** Bọc `db` để bước ghi `members` (bước 2 của `create`) ném lỗi như mất kết nối giữa giao dịch. */
function failingSecondStep(db: typeof t.db): typeof t.db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver);
      return (fn: (tx: typeof db) => Promise<unknown>) =>
        target.transaction((tx) =>
          fn(
            new Proxy(tx as unknown as typeof db, {
              get(txTarget, txProp, txReceiver) {
                if (txProp !== "insert")
                  return Reflect.get(txTarget, txProp, txReceiver);
                return (table: Parameters<typeof db.insert>[0]) =>
                  table === members
                    ? {
                        values: () => {
                          throw new Error("mất kết nối giữa giao dịch");
                        },
                      }
                    : txTarget.insert(table);
              },
            }),
          ),
        );
    },
  });
}

describe("all-or-nothing (QA-UNIT-010)", () => {
  it("lỗi ở bước 2 (ghi owner) hoàn tác bước 1: không còn workspace mồ côi", async () => {
    const svc = createWorkspaceService({ db: failingSecondStep(t.db) });
    await expect(
      svc.create({ actorId: "u1", name: "Cửa hàng A" }),
    ).rejects.toThrow("mất kết nối giữa giao dịch");
    expect(await t.db.select().from(workspaces)).toEqual([]);
    expect(await t.db.select().from(members)).toEqual([]);
  });

  it("sau lỗi, lần tạo kế tiếp vẫn thành công và nhất quán", async () => {
    const bad = createWorkspaceService({ db: failingSecondStep(t.db) });
    await expect(bad.create({ actorId: "u1", name: "A" })).rejects.toThrow();
    const ok = await createWorkspaceService({ db: t.db }).create({
      actorId: "u1",
      name: "A",
    });
    expect(await t.db.select().from(workspaces)).toHaveLength(1);
    expect(await t.db.select().from(members)).toEqual([
      expect.objectContaining({ workspaceId: ok.id, role: "owner" }),
    ]);
  });
});
