import { createHmac, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { createSecretBox } from "../src/security/secret-box";

// Cần DB đã migrate: đặt E2E_DATABASE_URL. Không đặt thì bỏ qua.
test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const SECRET = "e".repeat(64);
let client: pg.Client;
let connectionId: string;
let workspaceId: string;
const externalAccount = `acc_${randomUUID()}`;

test.beforeAll(async () => {
  // Cùng khoá với server do playwright.config.ts khởi động.
  const box = createSecretBox(Buffer.alloc(32, 7).toString("base64"));
  client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  workspaceId = (
    await client.query<{ id: string }>(
      "insert into workspaces (name) values ($1) returning id",
      ["Webhook e2e"],
    )
  ).rows[0]!.id;
  connectionId = (
    await client.query<{ id: string }>(
      `insert into provider_connections (workspace_id, provider, label, credentials_enc, webhook_secret_enc)
       values ($1, 'socialapi', 'wh', $2, $3) returning id`,
      [workspaceId, box.encrypt("KHOA"), box.encrypt(SECRET)],
    )
  ).rows[0]!.id;
  await client.query(
    `insert into social_accounts (connection_id, platform, external_id, display_name)
     values ($1, 'instagram', $2, 'Trang e2e')`,
    [connectionId, externalAccount],
  );
});

test.afterAll(async () => {
  await client.query("delete from workspaces where id = $1", [workspaceId]);
  await client.end();
});

const sign = (ts: number, body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
const nowSec = () => Math.floor(Date.now() / 1000);

function event(id: string) {
  return JSON.stringify({
    event: "dm.received",
    data: {
      id,
      platform: "instagram",
      author: { id: "u1", name: "Lan Anh 🌸" },
      content: { text: "Còn hàng không shop?" },
      received_at: new Date().toISOString(),
      account_id: externalAccount,
    },
  });
}

async function post(
  body: string,
  ts: number,
  signature: string,
  id = connectionId,
) {
  return fetch(
    `${process.env.E2E_BASE_URL ?? "http://localhost:3100"}/api/webhooks/socialapi/${id}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-socialapi-timestamp": String(ts),
        "x-socialapi-signature-v2": signature,
      },
      body,
    },
  );
}

const count = async (externalId: string) =>
  Number(
    (
      await client.query<{ n: string }>(
        "select count(*) n from inbox_items where external_id = $1",
        [externalId],
      )
    ).rows[0]!.n,
  );

test("webhook ký đúng → tin vào hộp thư đúng một lần dù giao trùng; Unicode giữ nguyên [F-003/AC-06]", async () => {
  const id = `sapi_dm_${randomUUID()}`;
  const body = event(id);
  const ts = nowSec();
  const first = await post(body, ts, sign(ts, body));
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ status: "ok", inserted: 1 });
  const again = await post(body, nowSec(), sign(nowSec(), body));
  expect(await again.json()).toEqual({ status: "ok", inserted: 0 });
  expect(await count(id)).toBe(1);
  const row = (
    await client.query<{ author: string; text: string; workspace_id: string }>(
      "select author, text, workspace_id from inbox_items where external_id = $1",
      [id],
    )
  ).rows[0]!;
  expect(row).toEqual({
    author: "Lan Anh 🌸",
    text: "Còn hàng không shop?",
    workspace_id: workspaceId,
  });
});

test("chữ ký sai, timestamp cũ, kết nối lạ → 401 giống nhau và không ghi gì", async () => {
  const id = `sapi_dm_${randomUUID()}`;
  const body = event(id);
  const ts = nowSec();
  const wrongSig = await post(body, ts, sign(ts, body, "x".repeat(64)));
  const stale = await post(body, ts - 600, sign(ts - 600, body));
  const unknown = await post(body, ts, sign(ts, body), randomUUID());
  for (const r of [wrongSig, stale, unknown]) {
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ status: "unauthorized" });
  }
  expect(await count(id)).toBe(0);
});

test("chữ ký tính trên thân gốc: đổi một byte (kể cả khoảng trắng) là bị từ chối", async () => {
  const id = `sapi_dm_${randomUUID()}`;
  const body = event(id);
  const ts = nowSec();
  const res = await post(body + "\n", ts, sign(ts, body));
  expect(res.status).toBe(401);
  expect(await count(id)).toBe(0);
});

test("thân quá lớn → 413", async () => {
  const body = "x".repeat(300_000);
  const ts = nowSec();
  expect((await post(body, ts, sign(ts, body))).status).toBe(413);
});
