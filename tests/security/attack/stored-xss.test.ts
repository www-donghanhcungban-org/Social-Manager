import { createHmac } from "node:crypto";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import ConversationPage from "@/app/app/[workspaceId]/conversations/[conversationId]/page";
import DocumentsPage from "@/app/app/[workspaceId]/documents/page";
import ProjectPage from "@/app/app/[workspaceId]/projects/[projectId]/page";
import {
  conversations,
  providerConnections,
  socialAccounts,
} from "@/src/db/schema";

import { createWorld, type World } from "./world";

/**
 * XSS lưu trữ: nội dung độc do BÊN NGOÀI gửi (tin nhắn qua webhook thật) hoặc do người trong workspace nhập (tên dự án, bí
 * danh, quyết định, id tài liệu) đi qua dịch vụ thật vào Postgres, rồi được TRANG THẬT (server component) đọc lại và render
 * ra HTML. Đầu ra không được chứa thẻ/thuộc tính chạy được; nội dung phải hiện nguyên văn ở dạng đã escape. Chỉ thay
 * `headers()`/`revalidatePath` của Next và gốc ghép nối đọc env (xem `world.ts`).
 */
const live = vi.hoisted(() => ({
  world: undefined as unknown as World,
  headers: new Headers(),
}));
vi.mock("next/headers", () => ({ headers: async () => live.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/src/server/container", () => ({
  createContainer: () => live.world.container,
}));
vi.mock("@/src/auth/server", () => ({ getAuth: () => live.world.auth }));
vi.mock("@/src/config/env", async (orig) => ({
  ...(await orig<typeof import("@/src/config/env")>()),
  loadEnv: () => ({}),
}));

/** Không có dấu nháy đơn để so khớp đơn giản với cách React escape văn bản. */
const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  '</p><iframe src="javascript:alert(1)">',
  '<a href="javascript:alert(1)">bấm</a>',
];
const DANGEROUS_TAGS = new Set([
  "script",
  "img",
  "svg",
  "iframe",
  "object",
  "embed",
]);

const escapeText = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Hiện vật của chính React DOM server khi form dùng hàm action ngoài runtime Next (không đến từ dữ liệu): giá trị `action`
 * giữ chỗ và một script nội tuyến chặn submit. Trong Next thật, form Server Action render khác; ở đây bỏ qua đúng hai hằng
 * này, còn lại mọi thẻ/thuộc tính đều bị kiểm.
 */
const REACT_FORM_ACTION =
  "javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)";
const REACT_SUBMIT_HELPER = '<script>addEventListener("submit",';

function stripReactHelper(html: string): string {
  const start = html.indexOf(REACT_SUBMIT_HELPER);
  if (start === -1) return html;
  const end = html.indexOf("</script>", start);
  return html.slice(0, start) + html.slice(end + "</script>".length);
}

interface Tag {
  name: string;
  attrs: [string, string][];
}

/**
 * Tách thẻ và thuộc tính THẬT của HTML do React sinh (React luôn đặt giá trị thuộc tính trong nháy kép và escape `"`) bằng
 * duyệt chuỗi tuyến tính — không dùng regex quay lui. Văn bản đã escape (`&lt;…`) không bao giờ thành thẻ ở đây.
 */
function tagsOf(html: string): Tag[] {
  const out: Tag[] = [];
  let i = html.indexOf("<");
  while (i !== -1) {
    const j = html.indexOf(">", i);
    if (j === -1) break;
    const raw = html.slice(i + 1, j);
    let k = 0;
    const isSpace = (c: string | undefined) =>
      c === " " || c === "\n" || c === "\t" || c === "/";
    while (k < raw.length && !isSpace(raw[k])) k++;
    const tag: Tag = { name: raw.slice(0, k).toLowerCase(), attrs: [] };
    while (k < raw.length) {
      while (k < raw.length && isSpace(raw[k])) k++;
      const s = k;
      while (k < raw.length && raw[k] !== "=" && !isSpace(raw[k])) k++;
      const name = raw.slice(s, k).toLowerCase();
      let value = "";
      if (raw[k] === "=" && raw[k + 1] === '"') {
        const close = raw.indexOf('"', k + 2);
        value = raw.slice(k + 2, close === -1 ? raw.length : close);
        k = close === -1 ? raw.length : close + 1;
      } else if (raw[k] === "=") {
        const s2 = ++k;
        while (k < raw.length && !isSpace(raw[k])) k++;
        value = raw.slice(s2, k);
      }
      if (name !== "") tag.attrs.push([name, value]);
    }
    out.push(tag);
    i = html.indexOf("<", j);
  }
  return out;
}

function expectInert(rendered: string, payloads: string[]) {
  const html = stripReactHelper(rendered);
  const bad: string[] = [];
  for (const tag of tagsOf(html)) {
    const name = tag.name.replace("/", "");
    if (DANGEROUS_TAGS.has(name)) bad.push(`thẻ ${name}`);
    for (const [attr, value] of tag.attrs) {
      if (attr.startsWith("on")) bad.push(`thuộc tính ${attr}`);
      const v = value.trim().toLowerCase();
      if (
        ["href", "src", "action", "formaction"].includes(attr) &&
        v.startsWith("javascript:") &&
        value !== REACT_FORM_ACTION
      )
        bad.push(`URL ${attr}=${value}`);
    }
  }
  expect(bad).toEqual([]);
  for (const p of payloads) expect(html).toContain(escapeText(p));
}

let w: World;
let ws: string;
const convIds: string[] = [];
const projectIds: string[] = [];

const render = async (page: Promise<ReactElement>) =>
  renderToStaticMarkup(await page);

beforeAll(async () => {
  w = await createWorld();
  live.world = w;
  const owner = await w.login("chu@example.com");
  live.headers = owner.headers;
  ws = (await w.services.workspaces.create({ actorId: owner.id, name: "W" }))
    .id;

  // (1) Kẻ ngoài gửi tin độc qua webhook ĐÃ KÝ hợp lệ (vd tài khoản khách trên mạng xã hội đặt tên/nhắn nội dung độc).
  const [c] = await w.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "socialapi",
      label: "SocialAPI",
      credentialsEnc: w.box.encrypt("KHOA"),
    })
    .returning();
  await w.db.insert(socialAccounts).values({
    connectionId: c!.id,
    platform: "instagram",
    externalId: "acc_W",
    displayName: PAYLOADS[0]!,
  });
  const secret = "q".repeat(64);
  await w.services.connections.setWebhookSecret({
    actorId: owner.id,
    workspaceId: ws,
    connectionId: c!.id,
    secret,
  });
  for (const [i, p] of PAYLOADS.entries()) {
    const body = JSON.stringify({
      event: "dm.received",
      data: {
        id: `dm-${i}`,
        platform_id: `mid.${i}`,
        conversation_id: `conv-${i}`,
        account_id: "acc_W",
        author: { id: `u${i}`, name: p },
        content: { text: `Tin: ${p}` },
        received_at: "2026-11-22T08:00:00Z",
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await w.services.webhooks.handle({
      connectionId: c!.id,
      rawBody: Buffer.from(body),
      timestamp: ts,
      signature: `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`,
    });
    expect(r.status).toBe(200);
  }
  for (const row of await w.db
    .select({ id: conversations.id, ext: conversations.externalId })
    .from(conversations))
    convIds[Number(row.ext.slice("conv-".length))] = row.id;

  // (2) Người trong workspace nhập tên dự án, bí danh, id tài liệu, quyết định có mã độc.
  const k = w.services.knowledge;
  const actor = { actorId: owner.id, workspaceId: ws };
  for (const [i, p] of PAYLOADS.entries()) {
    const project = await k.createProject({ ...actor, name: p });
    projectIds[i] = project.id;
    await k.addAlias({ ...actor, projectId: project.id, alias: `bd ${p}` });
    const ev = await w.services.evidence.ingest({
      ...actor,
      source: "document",
      externalId: p,
      content: `Nội dung ${p}`,
      contentType: "text/markdown",
      observedAt: new Date("2026-11-22T08:00:00Z"),
    });
    await k.link({
      ...actor,
      projectId: project.id,
      target: { type: "evidence", evidenceItemId: ev.itemId },
    });
    await k.recordDecision({
      ...actor,
      projectId: project.id,
      text: `QĐ ${p}`,
      sourceEvidenceItemId: ev.itemId,
    });
  }
});
afterAll(async () => {
  await w.t.client.close();
});

describe("XSS lưu trữ trong hội thoại (nội dung từ webhook)", () => {
  it.each(PAYLOADS.map((p, i) => [i, p] as const))(
    "trang hội thoại %i: tên người gửi, nội dung tin, tên trang không thành thẻ/thuộc tính chạy được",
    async (i, p) => {
      const html = await render(
        ConversationPage({
          params: Promise.resolve({
            workspaceId: ws,
            conversationId: convIds[i]!,
          }),
        }),
      );
      // Có nội dung thật trong trang (tránh xanh vì trang rỗng).
      expect(html).toContain('aria-label="Tin nhắn"');
      expectInert(html, [p, `Tin: ${p}`, PAYLOADS[0]!]);
    },
  );
});

describe("XSS lưu trữ trong tài liệu/dự án (nội dung người dùng nhập)", () => {
  it.each(PAYLOADS.map((p, i) => [i, p] as const))(
    "trang dự án %i: tên, bí danh, quyết định, id tài liệu trong dòng thời gian đều đã escape",
    async (i, p) => {
      const html = await render(
        ProjectPage({
          params: Promise.resolve({
            workspaceId: ws,
            projectId: projectIds[i]!,
          }),
        }),
      );
      expect(html).toContain('aria-label="Bằng chứng của dự án"');
      expectInert(html, [p, `bd ${p}`, `QĐ ${p}`]);
    },
  );

  it("trang danh sách tài liệu và dự án: mọi tên và bí danh độc đều đã escape", async () => {
    const html = await render(
      DocumentsPage({ params: Promise.resolve({ workspaceId: ws }) }),
    );
    expect(html).toContain('aria-label="Danh sách dự án"');
    expectInert(html, [...PAYLOADS, ...PAYLOADS.map((p) => `bd ${p}`)]);
  });

  it("bộ kiểm tự nó bắt được HTML chưa escape (đối chứng, tránh test luôn xanh)", () => {
    expect(() => expectInert(`<p>${PAYLOADS[1]}</p>`, [])).toThrow();
    expect(() => expectInert(`<p>${PAYLOADS[0]}</p>`, [])).toThrow();
    expect(() => expectInert(`<a href="javascript:x">a</a>`, [])).toThrow();
    expect(() => expectInert(`<div onmouseover="x">a</div>`, [])).toThrow();
    expect(() =>
      expectInert(`<form action=" JavaScript:alert(1)"></form>`, []),
    ).toThrow();
    // Hiện vật của React không bị tính, nhưng script khác đặt sau nó vẫn bị bắt.
    const helper = `${REACT_SUBMIT_HELPER}1)</script>`;
    expect(() =>
      expectInert(`<form action="${REACT_FORM_ACTION}"></form>${helper}`, []),
    ).not.toThrow();
    expect(() =>
      expectInert(`${helper}<script>alert(1)</script>`, []),
    ).toThrow();
  });
});
