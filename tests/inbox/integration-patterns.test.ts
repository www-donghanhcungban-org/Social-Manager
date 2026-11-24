import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSyncAccountPayload, syncAccountPayload } from "@/src/jobs/policy";
import { QUEUES } from "@/src/jobs/runner";
import { verifyWebhookSignature } from "@/src/providers/socialapi/webhook";

import { createTestDb } from "../db/helpers";

/**
 * MUST nhóm tích hợp (T-519): outbox, khử trùng, HMAC trên thân thô, payload job, URL do người dùng cấu hình.
 * Blueprint tick kèm `— Kiểm: npx vitest run tests/inbox/integration-patterns.test.ts …`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));

/** Thân của mọi `….transaction(async (x) => { … })` trong một tệp (đếm ngoặc nhọn). */
function transactionBodies(text: string): string[] {
  const out: string[] = [];
  const re = /\.transaction\(\s*async\s*\(\w+\)\s*=>\s*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    out.push(text.slice(re.lastIndex, i));
  }
  return out;
}

describe("outbox: ghi dữ liệu và việc phát tác động cùng giao dịch (ARC-INT-003)", () => {
  it("không có lời gọi mạng/hàng đợi/nhà cung cấp bên trong khối transaction của src/", () => {
    const forbidden =
      /\bfetch\(|doFetch\(|\.sendMessage\(|\.publishPost\(|publishViaProvider\(|\bqueue\.send\(|\bboss\.|createSocialApiClient\(|\.work\(/;
    const bad: string[] = [];
    let blocks = 0;
    for (const f of code("src"))
      for (const body of transactionBodies(read(f))) {
        blocks++;
        if (forbidden.test(body)) bad.push(f);
      }
    expect(blocks).toBeGreaterThan(8);
    expect(bad).toEqual([]);
  });

  it("sổ hành động là outbox: yêu cầu gửi chỉ xếp hàng, việc gửi chạy sau ở job riêng (có test cờ tắt → giữ hàng, bật lại thì gửi)", () => {
    expect(read("tests/actions/ledger.test.ts")).toMatch(
      /xếp hàng \(chưa gọi nhà cung cấp\)/,
    );
    expect(read("tests/actions/ledger.test.ts")).toMatch(
      /cờ hệ thống tắt giữa chừng: giữ nguyên hàng đợi \(deferred\), bật lại thì gửi/,
    );
    expect(QUEUES.actionsDispatch).toBe("actions.dispatch");
  });
});

describe("khử trùng consumer bằng ràng buộc UNIQUE (ARC-INT-005, BE-INT-004)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.client.close();
  });

  it("tin nhắn và mục hộp thư có UNIQUE theo id ngoài; bản ghi trùng bị CSDL từ chối", async () => {
    const r = await t.client.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'u' and conname in
       ('messages_account_external', 'inbox_items_account_kind_external', 'conversations_account_external',
        'action_ledger_ws_key', 'posts_ws_idempotency')`,
    );
    expect(r.rows.map((x) => x.conname).sort()).toEqual([
      "action_ledger_ws_key",
      "conversations_account_external",
      "inbox_items_account_kind_external",
      "messages_account_external",
      "posts_ws_idempotency",
    ]);
  });

  it("khử trùng không phụ thuộc thứ tự và không có TTL ngắn: khoá nằm cùng bản ghi (giữ tới khi xoá theo hạn lưu)", () => {
    const wh = read("src/inbox/webhook.ts");
    expect(wh).toMatch(/onConflict/);
    expect(read("tests/inbox/webhook.test.ts")).toMatch(
      /gửi lại cùng delivery \(SocialAPI giao ít nhất một lần\) → không trùng, vẫn 200/,
    );
  });
});

describe("webhook vào: HMAC trên thân thô (ARC-INT-008)", () => {
  const SECRET = "k".repeat(64);
  const NOW = 1_800_000_000_000;
  const ts = String(NOW / 1000);
  const raw = '{"event":"dm.received",  "data":{"id": "x1"}}'; // khoảng trắng lẻ: re-serialize sẽ đổi byte
  const sig = (body: string) =>
    `sha256=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
  const verify = (
    body: string,
    over: { timestamp?: string; signature?: string } = {},
  ) =>
    verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body),
      timestamp: over.timestamp ?? ts,
      signature: over.signature ?? sig(raw),
      nowMs: NOW,
    });

  it("thân thô nguyên bản hợp lệ; thân đã re-serialize (JSON.stringify(JSON.parse)) thì KHÔNG khớp chữ ký", () => {
    expect(verify(raw)).toBe(true);
    expect(verify(JSON.stringify(JSON.parse(raw)))).toBe(false);
  });

  it("chữ ký sai và timestamp ngoài cửa sổ 5 phút đều bị từ chối", () => {
    expect(verify(raw, { signature: sig(raw).replace(/.$/, "0") })).toBe(false);
    const old = String((NOW - 301_000) / 1000);
    expect(
      verify(raw, {
        timestamp: old,
        signature: `sha256=${createHmac("sha256", SECRET).update(`${old}.${raw}`).digest("hex")}`,
      }),
    ).toBe(false);
  });

  it("so sánh hằng thời gian và route đọc thân thô trước khi parse; sai chữ ký/timestamp/kết nối cùng 401, trùng id → 200 không xử lý lại", () => {
    expect(read("src/providers/socialapi/webhook.ts")).toMatch(
      /timingSafeEqual/,
    );
    const route = read("app/api/webhooks/socialapi/[connectionId]/route.ts");
    expect(route).toMatch(/arrayBuffer\(\)|Buffer\.from\(await/);
    const t = read("tests/inbox/webhook.test.ts");
    expect(t).toMatch(
      /sai chữ ký, thiếu chữ ký, timestamp cũ → cùng một phản hồi 401/,
    );
    expect(t).toMatch(/gửi lại cùng delivery/);
  });
});

describe("payload job tối thiểu có schema (BE-JOB-007, BE-JOB-001)", () => {
  it("syncAccount chỉ nhận workspaceId + accountId; trường lạ (bí mật), kiểu sai hay rỗng bị từ chối", () => {
    expect(
      parseSyncAccountPayload({ workspaceId: "w1", accountId: "a1" }),
    ).toEqual({
      workspaceId: "w1",
      accountId: "a1",
    });
    for (const bad of [
      null,
      undefined,
      {},
      { workspaceId: "", accountId: "a" },
      { workspaceId: "w", accountId: 1 },
      { workspaceId: "w", accountId: "a", token: "x" },
      { workspaceId: "w", accountId: "a", password: "x" },
    ])
      expect(() => parseSyncAccountPayload(bad), JSON.stringify(bad)).toThrow(
        /dữ liệu job/,
      );
    expect(Object.keys(syncAccountPayload.shape).sort()).toEqual([
      "accountId",
      "workspaceId",
    ]);
  });

  it("mã xếp việc không đưa trường nhạy cảm vào payload; việc theo tài khoản dùng job key (singletonKey)", () => {
    const runner = read("src/jobs/runner.ts");
    expect(runner).not.toMatch(
      /queue\.send\([^)]*(password|token|secret|apikey)/i,
    );
    expect(runner).toMatch(/singletonKey:\s*a\.accountId/);
  });
});

describe("URL do người dùng cấu hình mà server gọi (BE-INT-010, SEC-WEB-008)", () => {
  it("không có đường nhập URL: không trường biểu mẫu/schema nào kiểu URL; URL gọi ra chỉ từ biến môi trường hoặc hằng", () => {
    const bad: string[] = [];
    // `src/config/env.ts` là cấu hình của NGƯỜI VẬN HÀNH (biến môi trường), không phải đầu vào của người dùng cuối.
    for (const f of [...code("app"), ...code("src")].filter(
      (f) => f !== "src/config/env.ts",
    )) {
      const t = read(f);
      if (/\.get\(\s*["'][^"']*url[^"']*["']\s*\)/i.test(t))
        bad.push(`${f}: formData url`);
      if (/z\.(string\(\)\.url|url)\(/.test(t)) bad.push(`${f}: zod url`);
    }
    expect(bad).toEqual([]);
    const env = read("src/config/env.ts");
    expect(env).toMatch(/SOCIALAPI_BASE_URL/);
    expect(env).toMatch(/AI_BASE_URL/);
    expect(read("src/connectors/github/client.ts")).toMatch(
      /GITHUB_API_BASE|api\.github\.com/,
    );
  });

  it("bảng kết nối/tài khoản không có cột URL để người dùng đặt", () => {
    const schema = read("src/db/schema.ts");
    const conn =
      /export const providerConnections = [\s\S]*?\n\);/.exec(schema)?.[0] ??
      "";
    expect(conn.length).toBeGreaterThan(100);
    expect(conn).not.toMatch(/url|uri|endpoint/i);
  });

  it("client GitHub chỉ theo trang cùng origin (không theo Link sang nơi khác)", () => {
    expect(read("src/connectors/github/client.ts")).toMatch(/origin/);
  });
});
