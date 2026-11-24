import { createHmac } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/webhooks/socialapi/[connectionId]/route";
import {
  inboxItems,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
  members,
} from "@/src/db/schema";

import { createWorld, type World } from "./world";

/**
 * Giả mạo và phát lại webhook SocialAPI qua ROUTE THẬT (`POST /api/webhooks/socialapi/[connectionId]`): byte thô → kiểm chữ
 * ký HMAC-SHA256 V2 trên `<timestamp>.<thân>` → cửa sổ ±300 giây → chèn lũy đẳng vào Postgres (PGlite). Chỉ thay gốc ghép
 * nối đọc biến môi trường bằng container dựng trên PGlite với đồng hồ cố định.
 */
const live = vi.hoisted(() => ({ world: undefined as unknown as World }));
vi.mock("@/src/server/container", () => ({
  createContainer: () => live.world.container,
}));
vi.mock("@/src/config/env", async (orig) => ({
  ...(await orig<typeof import("@/src/config/env")>()),
  loadEnv: () => ({}),
}));

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const SECRET = "w".repeat(64);
const UNAUTHORIZED = { status: 401, body: { status: "unauthorized" } };

let w: World;
let conn: string;
let otherConn: string;

const sign = (body: string, ts: number | string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

async function send(
  body: string,
  headers: Record<string, string>,
  connectionId = conn,
) {
  const res = await POST(
    new Request(
      `http://localhost:3000/api/webhooks/socialapi/${connectionId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      },
    ),
    { params: Promise.resolve({ connectionId }) },
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

/** Gửi đúng như SocialAPI: timestamp + chữ ký V2 hợp lệ (có thể đè từng phần để giả mạo). */
const signed = (body: string, ts: number = NOW_S) => ({
  "x-socialapi-timestamp": String(ts),
  "x-socialapi-signature-v2": sign(body, ts),
});

const event = (id: string, text = "Chào shop") =>
  JSON.stringify({
    event: "comment.received",
    data: {
      id,
      account_id: "acc_A",
      author: { id: "u1", name: "Lan" },
      content: { text },
      received_at: "2026-11-22T08:00:00Z",
    },
  });

const rows = async () => ({
  items: await w.db.select().from(inboxItems),
  msgs: await w.db.select().from(messages),
});

beforeAll(async () => {
  w = await createWorld({ now: () => NOW_MS });
  live.world = w;
  const [ws] = await w.db.insert(workspaces).values({ name: "A" }).returning();
  await w.db
    .insert(members)
    .values({ workspaceId: ws!.id, userId: "owner-a", role: "owner" });
  const mk = async (label: string) => {
    const [c] = await w.db
      .insert(providerConnections)
      .values({
        workspaceId: ws!.id,
        provider: "socialapi",
        label,
        credentialsEnc: w.box.encrypt("KHOA"),
      })
      .returning();
    return c!.id;
  };
  conn = await mk("chính");
  otherConn = await mk("khác");
  await w.db.insert(socialAccounts).values([
    {
      connectionId: conn,
      platform: "instagram",
      externalId: "acc_A",
      displayName: "Trang A",
    },
    {
      connectionId: otherConn,
      platform: "instagram",
      externalId: "acc_A",
      displayName: "Trang A ở kết nối khác",
    },
  ]);
  for (const [connectionId, secret] of [
    [conn, SECRET],
    [otherConn, "o".repeat(64)],
  ] as const)
    await w.services.connections.setWebhookSecret({
      actorId: "owner-a",
      workspaceId: ws!.id,
      connectionId,
      secret,
    });
});
beforeEach(async () => {
  await w.db.delete(messages);
  await w.db.delete(inboxItems);
});
afterAll(async () => {
  await w.t.client.close();
});

describe("giả chữ ký: mọi biến thể → cùng một 401, không ghi gì", () => {
  it("chữ ký sai khoá, thiếu chữ ký, thiếu timestamp, chữ ký rỗng/rác, hex viết hoa, chỉ có header V1", async () => {
    const body = event("c-1");
    const good = signed(body);
    const forged: Record<string, string>[] = [
      {
        ...good,
        "x-socialapi-signature-v2": sign(body, NOW_S, "k".repeat(64)),
      },
      { "x-socialapi-timestamp": String(NOW_S) },
      { "x-socialapi-signature-v2": good["x-socialapi-signature-v2"] },
      { ...good, "x-socialapi-signature-v2": "" },
      { ...good, "x-socialapi-signature-v2": "sha256=" + "0".repeat(64) },
      { ...good, "x-socialapi-signature-v2": "sha256=zz" },
      {
        ...good,
        "x-socialapi-signature-v2": good["x-socialapi-signature-v2"]
          .replace("sha256=", "")
          .padStart(71, "x"),
      },
      {
        ...good,
        "x-socialapi-signature-v2": good["x-socialapi-signature-v2"].replace(
          /[a-f]/g,
          (c) => c.toUpperCase(),
        ),
      },
      // V1 (không ràng buộc thời gian) đã bị bỏ: chỉ có header V1 là không xác thực.
      {
        "x-socialapi-timestamp": String(NOW_S),
        "x-socialapi-signature": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      },
      {},
    ];
    for (const h of forged)
      expect(await send(body, h), JSON.stringify(h)).toEqual(UNAUTHORIZED);
    expect(await rows()).toEqual({ items: [], msgs: [] });
    // Đối chứng: đúng chữ ký thì nhận.
    expect(await send(body, good)).toEqual({
      status: 200,
      body: { status: "ok", inserted: 1 },
    });
  });

  it("sửa thân sau khi ký (đổi nội dung, đổi account, thêm khoảng trắng) → 401", async () => {
    const body = event("c-2");
    const h = signed(body);
    for (const tampered of [
      event("c-2", "Chuyển khoản vào số khác"),
      body.replace("acc_A", "acc_B"),
      `${body} `,
      body.replace("Chào", "Chao"),
    ])
      expect(await send(tampered, h)).toEqual(UNAUTHORIZED);
    expect((await rows()).items).toEqual([]);
  });

  it("chữ ký hợp lệ của kết nối khác, hoặc gửi đúng chữ ký sang kết nối khác → 401", async () => {
    const body = event("c-3");
    expect(
      await send(body, {
        "x-socialapi-timestamp": String(NOW_S),
        "x-socialapi-signature-v2": sign(body, NOW_S, "o".repeat(64)),
      }),
    ).toEqual(UNAUTHORIZED);
    expect(await send(body, signed(body), otherConn)).toEqual(UNAUTHORIZED);
    expect((await rows()).items).toEqual([]);
  });
});

describe("phát lại: cửa sổ 300 giây và lũy đẳng", () => {
  it("timestamp lệch 301 giây (quá khứ hoặc tương lai) → 401 dù chữ ký đúng; lệch đúng 300 giây vẫn nhận (biên)", async () => {
    for (const ts of [NOW_S - 301, NOW_S + 301, NOW_S - 86_400, 0])
      expect(
        await send(event("c-4"), signed(event("c-4"), ts)),
        String(ts),
      ).toEqual(UNAUTHORIZED);
    expect((await rows()).items).toEqual([]);
    expect(
      (await send(event("c-4"), signed(event("c-4"), NOW_S - 300))).status,
    ).toBe(200);
    expect(
      (await send(event("c-5"), signed(event("c-5"), NOW_S + 300))).status,
    ).toBe(200);
  });

  it("timestamp không phải số nguyên giây (ms, số thập phân, âm, chữ) → 401", async () => {
    const body = event("c-6");
    for (const ts of [`${NOW_MS}`, `${NOW_S}.0`, `-${NOW_S}`, "abc", "1.8e9"])
      expect(
        await send(body, {
          "x-socialapi-timestamp": ts,
          "x-socialapi-signature-v2": sign(body, ts),
        }),
        ts,
      ).toEqual(UNAUTHORIZED);
  });

  it("phát lại nguyên bản trong cửa sổ → 200 nhưng không tạo bản ghi thứ hai", async () => {
    const body = event("c-7");
    const h = signed(body);
    expect((await send(body, h)).body).toEqual({ status: "ok", inserted: 1 });
    for (let i = 0; i < 3; i++)
      expect((await send(body, h)).body).toEqual({ status: "ok", inserted: 0 });
    expect((await rows()).items).toHaveLength(1);
  });

  it("đồng thời: 25 bản phát lại cùng lúc (cùng khoá sự kiện) → đúng một dòng hộp thư, một tin nhắn", async () => {
    const comment = event("c-8");
    const dm = JSON.stringify({
      event: "dm.received",
      data: {
        id: "dm-8",
        platform_id: "mid.8",
        conversation_id: "conv-8",
        account_id: "acc_A",
        author: { id: "u8", name: "Hà" },
        content: { text: "Đặt hàng" },
        received_at: "2026-11-22T08:00:00Z",
      },
    });
    const all = await Promise.all([
      ...Array.from({ length: 25 }, () => send(comment, signed(comment))),
      ...Array.from({ length: 25 }, () => send(dm, signed(dm))),
    ]);
    expect(all.every((r) => r.status === 200)).toBe(true);
    const { items, msgs } = await rows();
    expect(items.filter((i) => i.externalId === "c-8")).toHaveLength(1);
    expect(items.filter((i) => i.externalId === "conv-8")).toHaveLength(1);
    expect(msgs).toHaveLength(1);
  });

  it("phát lại cùng sự kiện với timestamp mới (kẻ có secret ký lại) vẫn không nhân đôi: khoá là id sự kiện", async () => {
    const body = event("c-9");
    await send(body, signed(body, NOW_S - 10));
    expect((await send(body, signed(body, NOW_S))).body).toEqual({
      status: "ok",
      inserted: 0,
    });
    expect((await rows()).items).toHaveLength(1);
  });
});

describe("dò kết nối và thân khổng lồ", () => {
  it("id kết nối lạ / không phải UUID / chuỗi tấn công → cùng 401 như sai chữ ký (không lộ kết nối nào tồn tại)", async () => {
    const body = event("c-10");
    for (const id of [
      "00000000-0000-4000-8000-000000000000",
      "../../admin",
      "' or 1=1 --",
      "x".repeat(300),
    ])
      expect(await send(body, signed(body), id), id).toEqual(UNAUTHORIZED);
  });

  it("Content-Length khai > 256 KB → 413 trước khi đọc thân; thân thật quá trần dù khai nhỏ → 413", async () => {
    const res = await POST(
      new Request(`http://localhost:3000/api/webhooks/socialapi/${conn}`, {
        method: "POST",
        headers: { "content-length": String(10 * 1024 * 1024) },
        body: "{}",
      }),
      { params: Promise.resolve({ connectionId: conn }) },
    );
    expect(res.status).toBe(413);
    const big = "x".repeat(300 * 1024);
    expect((await send(big, signed(big))).status).toBe(413);
    expect((await rows()).items).toEqual([]);
  });
});
