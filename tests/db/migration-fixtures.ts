// Dữ liệu tổng hợp + ảnh chụp bảng cho test lùi/tiến migration (T-580 migration-data, T-581 rollback-drill).
// Dùng SQL thô (không qua schema TS) để dữ liệu bám đúng cột/ràng buộc mà migration thật tạo ra.
import { readFileSync } from "node:fs";

import type { PGlite } from "@electric-sql/pglite";

import { MIGRATIONS, tableNames } from "./helpers";

export type JournalEntry = { tag: string; when: number };

export const JOURNAL: JournalEntry[] = (
  JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  }
).entries;
export const TAGS = JOURNAL.map((e) => e.tag);

const u = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = {
  ws1: u(1),
  ws2: u(2),
  pc1: u(10),
  sa1: u(20),
  post1: u(30),
  post2: u(31),
  post3: u(32),
  post4: u(33),
  inbox1: u(40),
  conv1: u(50),
  msg1: u(60),
  msg2: u(61),
  blob1: u(70),
  blob2: u(71),
  ev1: u(80),
  ev2: u(81),
  proj1: u(90),
  alias1: u(91),
  link1: u(92),
  link2: u(93),
  cp1: u(100),
  cur1: u(110),
  sd1: u(120),
  dec1: u(130),
  ad1: u(140),
  draft1: u(150),
  dv1: u(151),
  dv2: u(152),
  al1: u(160),
  ae1: u(170),
  cs1: u(180),
};
const hex = (c: string) => c.repeat(64);
const T0 = "2026-11-20T08:00:00Z";
const T1 = "2026-11-21T09:30:00Z";
const T2 = "2026-12-21T09:30:00Z";

/**
 * Chèn ít nhất một dòng hợp lệ vào MỌI bảng ở schema HEAD. Bảng mới thêm mà không chèn ở đây thì
 * `expectEveryTableSeeded` đỏ — hàng rào để kiểm lùi/tiến luôn có dữ liệu ở mọi bảng.
 */
export async function seedAllTables(client: PGlite) {
  await client.exec(`
INSERT INTO "workspaces" ("id","name","created_at","inbox_retention_days","retain_inbox_forever","ai_cloud_enabled","outbound_enabled","outbound_max_per_hour")
VALUES ('${ID.ws1}','Shop A','${T0}',30,false,true,true,5),
       ('${ID.ws2}','Shop B ữ','${T0}',null,true,false,false,10);
INSERT INTO "members" ("workspace_id","user_id","role","created_at")
VALUES ('${ID.ws1}','user-1','owner','${T0}'), ('${ID.ws1}','user-2','member','${T1}'), ('${ID.ws2}','user-2','admin','${T1}');
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at")
VALUES ('user-1','Lan','lan@example.test',true,null,'${T0}','${T0}'), ('user-2','Minh','minh@example.test',false,'https://example.test/a.png','${T0}','${T1}');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id")
VALUES ('sess-1','${T2}','tok-1','${T0}','${T1}','203.0.113.5','Vitest','user-1');
INSERT INTO "account" ("id","account_id","provider_id","user_id","password","created_at","updated_at")
VALUES ('acc-1','user-1','credential','user-1','scrypt:hash','${T0}','${T0}');
INSERT INTO "verification" ("id","identifier","value","expires_at","created_at","updated_at")
VALUES ('ver-1','lan@example.test','code-1','${T2}','${T0}','${T0}');
INSERT INTO "provider_connections" ("id","workspace_id","provider","label","credentials_enc","created_at","webhook_secret_enc")
VALUES ('${ID.pc1}','${ID.ws1}','socialapi','chính','v1:cred','${T0}','v1:wh');
INSERT INTO "social_accounts" ("id","connection_id","platform","external_id","display_name","created_at")
VALUES ('${ID.sa1}','${ID.pc1}','facebook','page-1','Trang A','${T0}');
INSERT INTO "posts" ("id","workspace_id","social_account_id","created_by","text","status","scheduled_at","published_at","external_id","error_code","attempts","idempotency_key","created_at")
VALUES ('${ID.post1}','${ID.ws1}','${ID.sa1}','user-1','Bài hẹn giờ','scheduled','${T2}',null,null,null,0,'k1','${T0}'),
       ('${ID.post2}','${ID.ws1}','${ID.sa1}','user-1','Bài đã nộp','submitted','${T1}',null,'ext-p2',null,1,'k2','${T0}'),
       ('${ID.post3}','${ID.ws1}','${ID.sa1}','user-1','Bài chưa rõ','send_unknown','${T1}',null,null,null,1,'k3','${T0}'),
       ('${ID.post4}','${ID.ws1}','${ID.sa1}','user-1','Bài đã đăng','published','${T0}','${T1}','ext-p4',null,1,'k4','${T0}');
INSERT INTO "inbox_items" ("id","workspace_id","social_account_id","kind","external_id","author","text","received_at","status","handled_by","created_at")
VALUES ('${ID.inbox1}','${ID.ws1}','${ID.sa1}','comment','cmt-1','Lan','Đẹp quá','${T1}','handled','user-1','${T1}');
INSERT INTO "login_throttle" ("key_hash","failures","locked_until","updated_at")
VALUES ('${hex("e")}',3,'${T2}','${T1}');
INSERT INTO "conversations" ("id","workspace_id","social_account_id","external_id","participant_id","participant_name","last_message_at","synced_through","created_at")
VALUES ('${ID.conv1}','${ID.ws1}','${ID.sa1}','conv-1','psid-1','Lan','${T1}','${T1}','${T0}');
INSERT INTO "messages" ("id","workspace_id","conversation_id","social_account_id","external_id","identity_weak","provider_message_id","direction","author","text","sent_at","created_at")
VALUES ('${ID.msg1}','${ID.ws1}','${ID.conv1}','${ID.sa1}','mid.1',false,'pm-1','incoming','Lan','Còn hàng không?','${T0}','${T0}'),
       ('${ID.msg2}','${ID.ws1}','${ID.conv1}','${ID.sa1}','mid.2',true,null,'outgoing','Shop A','Còn ạ','${T1}','${T1}');
INSERT INTO "evidence_blobs" ("id","workspace_id","sha256","size_bytes","content_type","created_at")
VALUES ('${ID.blob1}','${ID.ws1}','${hex("a")}',15,'text/plain','${T0}'), ('${ID.blob2}','${ID.ws1}','${hex("b")}',42,'text/markdown','${T0}');
INSERT INTO "evidence_items" ("id","workspace_id","blob_id","source","external_id","observed_at","created_at","message_id")
VALUES ('${ID.ev1}','${ID.ws1}','${ID.blob1}','message','mid.1','${T0}','${T0}','${ID.msg1}'),
       ('${ID.ev2}','${ID.ws1}','${ID.blob2}','document','doc-1','${T1}','${T1}',null);
INSERT INTO "projects" ("id","workspace_id","name","name_key","created_at")
VALUES ('${ID.proj1}','${ID.ws1}','Dự án A','du an a','${T0}');
INSERT INTO "project_aliases" ("id","workspace_id","project_id","alias","alias_key","created_at")
VALUES ('${ID.alias1}','${ID.ws1}','${ID.proj1}','DA-A','da-a','${T0}');
INSERT INTO "project_links" ("id","workspace_id","project_id","target_type","conversation_id","evidence_item_id","created_by","created_at")
VALUES ('${ID.link1}','${ID.ws1}','${ID.proj1}','conversation','${ID.conv1}',null,'user-1','${T0}'),
       ('${ID.link2}','${ID.ws1}','${ID.proj1}','evidence',null,'${ID.ev2}','user-1','${T1}');
INSERT INTO "source_checkpoints" ("id","workspace_id","social_account_id","last_run_at","last_success_at","consecutive_failures","last_error_code","created_at")
VALUES ('${ID.cp1}','${ID.ws1}','${ID.sa1}','${T1}','${T0}',2,'rate_limited','${T0}');
INSERT INTO "connector_cursors" ("id","workspace_id","connector","scope","cursor","last_run_at","last_error_code","created_at")
VALUES ('${ID.cur1}','${ID.ws1}','github','org/repo','cur-1','${T1}',null,'${T0}');
INSERT INTO "search_documents" ("id","workspace_id","evidence_item_id","text_folded","created_at")
VALUES ('${ID.sd1}','${ID.ws1}','${ID.ev2}','tai lieu du an','${T1}');
INSERT INTO "decisions" ("id","workspace_id","project_id","text","status","decided_at","source_evidence_item_id","source_label","superseded_by_id","created_by","created_at")
VALUES ('${ID.dec1}','${ID.ws1}','${ID.proj1}','Chọn Postgres','active','${T1}','${ID.ev2}','doc-1',null,'user-1','${T1}');
INSERT INTO "ai_disclosures" ("id","workspace_id","actor_id","purpose","endpoint_host","model","local","item_count","bytes_sent","status","error_code","created_at")
VALUES ('${ID.ad1}','${ID.ws1}','user-1','summarize','api.example.test','m-1',false,3,1200,'error','timeout','${T1}');
INSERT INTO "drafts" ("id","workspace_id","conversation_id","status","current_version","created_by","created_at","updated_at")
VALUES ('${ID.draft1}','${ID.ws1}','${ID.conv1}','sent',2,'user-1','${T0}','${T1}');
INSERT INTO "draft_versions" ("id","workspace_id","draft_id","version","text","source","created_by","created_at")
VALUES ('${ID.dv1}','${ID.ws1}','${ID.draft1}',1,'Nháp AI','ai','user-1','${T0}'),
       ('${ID.dv2}','${ID.ws1}','${ID.draft1}',2,'Còn ạ','human','user-1','${T1}');
INSERT INTO "action_ledger" ("id","workspace_id","kind","state","draft_id","draft_version","conversation_id","recipient_ref","text_hash","text_bytes","idempotency_key","provider_message_ids","attempts","created_by","created_at","dispatched_at","finished_at")
VALUES ('${ID.al1}','${ID.ws1}','send_message','confirmed','${ID.draft1}',2,'${ID.conv1}','psid-1','${hex("c")}',6,'idem-1',ARRAY['mid.2'],1,'user-1','${T1}','${T1}','${T1}');
INSERT INTO "audit_events" ("id","workspace_id","actor_id","action","target_type","target_id","outcome","reason","source_ip","user_agent","request_id","created_at")
VALUES ('${ID.ae1}','${ID.ws1}','user-1','consent.grant','workspace','${ID.ws1}','success',null,'203.0.113.5','Vitest','req-1','${T1}');
INSERT INTO "consents" ("id","workspace_id","subject_id","purpose_id","policy_version","granted_at","channel","ui_snapshot_hash","withdrawn_at","created_at")
VALUES ('${ID.cs1}','${ID.ws1}','user-1','ai_cloud','2026-11','${T1}','settings','${hex("d")}',null,'${T1}');
`);
}

export type Row = Record<string, unknown>;
export type TableShot = { columns: string[]; rows: Row[] };
export type Snapshot = Map<string, TableShot>;

/** Ảnh chụp mọi bảng public: tên cột + toàn bộ dòng (to_jsonb, nên kiểu nào cũng so được). */
export async function snapshot(client: PGlite): Promise<Snapshot> {
  const shot: Snapshot = new Map();
  for (const table of await tableNames(client)) {
    const cols = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by column_name`,
      [table],
    );
    const rows = await client.query<{ r: Row }>(
      `select to_jsonb(t) as r from "${table}" t`,
    );
    shot.set(table, {
      columns: cols.rows.map((c) => c.column_name),
      rows: rows.rows.map((x) => x.r),
    });
  }
  return shot;
}

/** Chiếu dòng lên tập cột (thứ tự cột cố định) rồi sắp theo chuỗi JSON để so không phụ thuộc thứ tự vật lý. */
export function project(rows: Row[], columns: string[]): Row[] {
  const sorted = [...columns].sort();
  return rows
    .map((r) => Object.fromEntries(sorted.map((c) => [c, r[c]])))
    .sort((a, b) => {
      const x = JSON.stringify(a);
      const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

export const journalWhens = async (client: PGlite) =>
  (
    await client.query<{ created_at: string }>(
      "select created_at from drizzle.__drizzle_migrations order by created_at",
    )
  ).rows.map((r) => Number(r.created_at));

/**
 * Biến đổi dữ liệu mà một file `.down.sql` CỐ Ý làm trên bảng còn tồn tại (đã ghi trong comment của file đó).
 * Ngoài danh sách này, lùi không được đổi dòng nào của bảng còn lại.
 *  - 0007_post_status_honest: schema cũ chỉ có 4 trạng thái → submitted/partial thành published, send_unknown thành
 *    failed (error_code rỗng ghi 'send_unknown'). Mất sắc thái trạng thái, KHÔNG mất dòng.
 */
export function expectedAfterDown(
  downed: readonly string[],
  table: string,
  rows: Row[],
): Row[] {
  if (table !== "posts" || !downed.includes("0007_post_status_honest"))
    return rows;
  return rows.map((r) => {
    if (r.status === "submitted" || r.status === "partial")
      return { ...r, status: "published" };
    if (r.status === "send_unknown")
      return {
        ...r,
        status: "failed",
        error_code: r.error_code ?? "send_unknown",
      };
    return r;
  });
}

export type Diff = { table: string; columns: string[] };

/**
 * Bảng có ở cả hai ảnh: giữ nguyên số dòng và nội dung trên các cột có ở cả hai phía. Cột/bảng mà migration bị lùi
 * tạo ra thì bản chất mất khi lùi (DROP trong .down.sql) — chỉ so phần còn tồn tại. Trả danh sách bảng đã so.
 */
export function comparable(before: Snapshot, after: Snapshot): Diff[] {
  const out: Diff[] = [];
  for (const [table, b] of before) {
    const a = after.get(table);
    if (!a) continue;
    out.push({
      table,
      columns: b.columns.filter((c) => a.columns.includes(c)),
    });
  }
  return out;
}
