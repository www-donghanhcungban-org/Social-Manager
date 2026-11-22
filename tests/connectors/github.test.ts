import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ForbiddenError } from "@/src/auth/errors";
import {
  createGithubClient,
  GithubError,
} from "@/src/connectors/github/client";
import { createGithubImporter } from "@/src/connectors/github/importer";
import {
  connectorCursors,
  evidenceItems,
  members,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { ValidationError } from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

const TOKEN = "ghp_SECRET_TOKEN_1234567890";
const NOW = new Date("2026-11-22T10:00:00Z");

interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
type Handler = (
  url: URL,
  init: RequestInit,
) => FakeResponse | Promise<FakeResponse>;

function fakeFetch(handler: Handler) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = await handler(url, init ?? {});
    return new Response(
      typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? []),
      { status: r.status ?? 200, headers: r.headers },
    );
  }) as typeof fetch;
  return { fn, calls };
}

const issue = (
  n: number,
  updated: string,
  over: Record<string, unknown> = {},
) => ({
  number: n,
  title: `Vấn đề ${n}`,
  body: `Nội dung ${n}`,
  state: "open",
  user: { login: "lan" },
  labels: [{ name: "bug" }, "ui"],
  created_at: "2026-11-01T00:00:00Z",
  updated_at: updated,
  html_url: `https://github.com/acme/web/issues/${n}`,
  ...over,
});
const pr = (n: number, updated: string) =>
  issue(n, updated, { pull_request: { url: "x" }, title: `PR ${n}` });
const review = (id: number, submitted: string | null, state = "APPROVED") => ({
  id,
  state,
  body: `Duyệt ${id}`,
  user: { login: "minh" },
  submitted_at: submitted,
  html_url: `https://github.com/acme/web/pull/1#pullrequestreview-${id}`,
});

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let wsB: string;
let evidence: ReturnType<typeof createEvidenceService>;
const A = { actorId: "admin" };

const importer = (f: typeof fetch) =>
  createGithubImporter({
    db: t.db,
    evidence,
    now: () => NOW,
    fetchImpl: f,
  });
const run = (f: typeof fetch, over: Record<string, unknown> = {}) =>
  importer(f).importRepo({
    ...A,
    workspaceId: ws,
    owner: "acme",
    repo: "web",
    token: TOKEN,
    ...over,
  });
const items = async () =>
  (await t.db.select().from(evidenceItems)).map((i) => i.externalId).sort();

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
  evidence = createEvidenceService({
    db: t.db,
    store: createMemoryBlobStore(),
  });
});
afterEach(async () => {
  await t.client.close();
});

/** Máy chủ giả theo hợp đồng: issues lọc theo `since` (>=), tăng dần theo updated_at. */
function server(
  all: ReturnType<typeof issue>[],
  reviews: Record<number, unknown[]> = {},
) {
  return fakeFetch((url) => {
    const m = /^\/repos\/acme\/web\/pulls\/(\d+)\/reviews$/.exec(url.pathname);
    if (m) return { body: reviews[Number(m[1])] ?? [] };
    if (url.pathname === "/repos/acme/web/issues") {
      const since = url.searchParams.get("since");
      return {
        body: all
          .filter((i) => !since || i.updated_at >= since)
          .sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
      };
    }
    return { status: 404, body: { message: "Not Found" } };
  });
}

describe("nhập issue, PR và review", () => {
  it("nhập issue, PR và review vào kho; nội dung JSON có trường cần thiết; header đúng", async () => {
    const s = server(
      [issue(1, "2026-11-10T00:00:00Z"), pr(2, "2026-11-11T00:00:00Z")],
      { 2: [review(77, "2026-11-12T00:00:00Z"), review(78, null, "PENDING")] },
    );
    const r = await run(s.fn);
    expect(r).toMatchObject({
      status: "complete",
      issues: 1,
      pullRequests: 1,
      reviews: 1,
      newVersions: 3,
      cursor: "2026-11-11T00:00:00Z",
    });
    expect(await items()).toEqual([
      "acme/web#1",
      "acme/web#2",
      "acme/web#2/review/77",
    ]);
    const [issueItem] = await t.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.externalId, "acme/web#1"));
    const got = await evidence.getContent({
      ...A,
      workspaceId: ws,
      itemId: issueItem!.id,
    });
    expect(JSON.parse(new TextDecoder().decode(got.content))).toEqual({
      kind: "issue",
      number: 1,
      title: "Vấn đề 1",
      body: "Nội dung 1",
      state: "open",
      author: "lan",
      labels: ["bug", "ui"],
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-10T00:00:00Z",
      url: "https://github.com/acme/web/issues/1",
    });
    expect(issueItem!.observedAt).toEqual(new Date("2026-11-10T00:00:00Z"));
    const h = s.calls[0]!.headers;
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(h.Accept).toBe("application/vnd.github+json");
    expect(s.calls[0]!.url.searchParams.get("per_page")).toBe("100");
  });

  it("chạy lại lũy đẳng: dùng con trỏ làm since, không nhân đôi", async () => {
    const s = server([issue(1, "2026-11-10T00:00:00Z")]);
    await run(s.fn);
    const r2 = await run(s.fn);
    expect(r2.newVersions).toBe(0);
    expect(s.calls.at(-1)!.url.searchParams.get("since")).toBe(
      "2026-11-10T00:00:00Z",
    );
    expect(await items()).toEqual(["acme/web#1"]);
    const [cur] = await t.db.select().from(connectorCursors);
    expect(cur).toMatchObject({
      connector: "github",
      scope: "acme/web",
      cursor: "2026-11-10T00:00:00Z",
      lastErrorCode: null,
    });
  });

  it("issue bị sửa thành phiên bản mới, bản cũ vẫn còn", async () => {
    const all = [issue(1, "2026-11-10T00:00:00Z")];
    await run(server(all).fn);
    all[0] = issue(1, "2026-11-15T00:00:00Z", { body: "đã sửa" });
    const r = await run(server(all).fn);
    expect(r.newVersions).toBe(1);
    const rows = await t.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.externalId, "acme/web#1"));
    expect(rows).toHaveLength(2);
  });

  it("chạm trần trang: partial rồi lượt sau đọc tiếp, đủ mọi mục", async () => {
    const all = [1, 2, 3].map((n) => issue(n, `2026-11-0${n}T00:00:00Z`));
    // máy chủ phân trang 1 mục/trang qua Link
    const s = fakeFetch((url) => {
      if (!url.pathname.endsWith("/issues")) return { body: [] };
      const since = url.searchParams.get("since");
      const list = all.filter((i) => !since || i.updated_at >= since);
      const p = Number(url.searchParams.get("page") ?? 1);
      const nextUrl = new URL(url);
      nextUrl.searchParams.set("page", String(p + 1));
      return {
        body: [list[p - 1]].filter(Boolean),
        headers:
          p < list.length ? { link: `<${nextUrl}>; rel="next"` } : undefined,
      };
    });
    const r1 = await run(s.fn, { maxPages: 2 });
    expect(r1.status).toBe("partial");
    expect(await items()).toEqual(["acme/web#1", "acme/web#2"]);
    const r2 = await run(s.fn, { maxPages: 2 });
    expect(r2.status).toBe("complete");
    expect(await items()).toEqual(["acme/web#1", "acme/web#2", "acme/web#3"]);
  });

  it("phân trang review của PR theo Link", async () => {
    const s = fakeFetch((url) => {
      if (url.pathname.endsWith("/issues"))
        return { body: [pr(1, "2026-11-10T00:00:00Z")] };
      const p = Number(url.searchParams.get("page") ?? 1);
      const next = new URL(url);
      next.searchParams.set("page", "2");
      return p === 1
        ? {
            body: [review(1, "2026-11-11T00:00:00Z")],
            headers: { link: `<${next}>; rel="next"` },
          }
        : { body: [review(2, "2026-11-12T00:00:00Z")] };
    });
    expect((await run(s.fn)).reviews).toBe(2);
  });
});

describe("giới hạn tốc độ và lỗi", () => {
  const limited = (headers: Record<string, string>, status = 403) =>
    fakeFetch((url) => {
      if (url.searchParams.get("page") === "2")
        return { status, body: { message: "rate limit" }, headers };
      return {
        body: [issue(1, "2026-11-10T00:00:00Z")],
        headers: {
          link: `<${new URL("/repos/acme/web/issues?page=2", url)}>; rel="next"`,
        },
      };
    });

  it("403 hết hạn mức: dừng ngay, giữ tiến độ, báo thời điểm gọi lại, không gọi thêm", async () => {
    const reset = Math.floor(NOW.getTime() / 1000) + 600;
    const s = limited({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(reset),
    });
    const r = await run(s.fn);
    expect(r).toMatchObject({
      status: "rate_limited",
      issues: 1,
      cursor: "2026-11-10T00:00:00Z",
      retryAt: new Date(reset * 1000).toISOString(),
    });
    expect(s.calls).toHaveLength(2);
    const [cur] = await t.db.select().from(connectorCursors);
    expect(cur).toMatchObject({
      cursor: "2026-11-10T00:00:00Z",
      lastErrorCode: "rate_limited",
    });
    expect(await items()).toEqual(["acme/web#1"]);
  });

  it("429 với retry-after tính theo giây từ bây giờ", async () => {
    const r = await run(limited({ "retry-after": "60" }, 429).fn);
    expect(r.status).toBe("rate_limited");
    expect(r.retryAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("403 không phải hạn mức là lỗi quyền, ném ra với mã an toàn và ghi vào con trỏ", async () => {
    const s = limited({});
    await expect(run(s.fn)).rejects.toMatchObject({ code: "http.403" });
    const [cur] = await t.db.select().from(connectorCursors);
    expect(cur!.lastErrorCode).toBe("http.403");
  });

  it.each([
    [401, "unauthorized"],
    [404, "not_found"],
    [500, "http.500"],
  ])("HTTP %i → mã %s", async (status, code) => {
    const s = fakeFetch(() => ({ status, body: { message: `lộ ${TOKEN}` } }));
    const err = await run(s.fn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect((err as GithubError).code).toBe(code);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("phản hồi sai hình dạng hoặc không phải JSON là client.invalid_response", async () => {
    await expect(
      run(fakeFetch(() => ({ body: [{ number: "x" }] })).fn),
    ).rejects.toMatchObject({ code: "client.invalid_response" });
    await expect(
      run(fakeFetch(() => ({ body: "<html>" })).fn),
    ).rejects.toMatchObject({ code: "client.invalid_response" });
  });

  it("lỗi mạng: không lộ URL/token trong thông báo", async () => {
    const f = (async () => {
      throw new Error(`ECONNRESET https://api.github.com ${TOKEN}`);
    }) as unknown as typeof fetch;
    const err = (await run(f).catch((e: unknown) => e)) as GithubError;
    expect(err.code).toBe("client.network");
    expect(err.message).not.toMatch(/ECONNRESET|ghp_|github\.com/);
  });

  it("không bao giờ gửi token tới nơi khác: Link ngoài nguồn bị chặn", async () => {
    const s = fakeFetch(() => ({
      body: [issue(1, "2026-11-10T00:00:00Z")],
      headers: { link: '<https://evil.example/steal?page=2>; rel="next"' },
    }));
    await expect(run(s.fn)).rejects.toMatchObject({ code: "client.bad_link" });
    expect(
      s.calls.every((c) => c.url.origin === "https://api.github.com"),
    ).toBe(true);
  });

  it("token rỗng bị từ chối trước khi gọi mạng; token không nằm trong con trỏ đã lưu", async () => {
    const s = server([issue(1, "2026-11-10T00:00:00Z")]);
    await expect(run(s.fn, { token: "  " })).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(s.calls).toHaveLength(0);
    await run(s.fn);
    expect(
      JSON.stringify(await t.db.select().from(connectorCursors)),
    ).not.toContain(TOKEN);
  });
});

describe("đầu vào và quyền", () => {
  it("từ chối tên chủ sở hữu/repo có ký tự đường dẫn và trần trang sai, trước khi gọi mạng", async () => {
    const s = server([]);
    for (const over of [
      { owner: "../x" },
      { repo: "a/b" },
      { owner: "" },
      { repo: "x".repeat(101) },
      { maxPages: 0 },
      { maxPages: 101 },
      { maxPages: 1.5 },
    ])
      await expect(run(s.fn, over)).rejects.toBeInstanceOf(ValidationError);
    expect(s.calls).toHaveLength(0);
  });

  it("member và người ngoài bị Forbidden; mục nhập vào đúng workspace", async () => {
    const s = server([issue(1, "2026-11-10T00:00:00Z")]);
    for (const actorId of ["member", "other"])
      await expect(run(s.fn, { actorId })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    expect(s.calls).toHaveLength(0);
    await run(s.fn);
    expect(
      (await t.db.select().from(evidenceItems)).every(
        (i) => i.workspaceId === ws,
      ),
    ).toBe(true);
  });

  it("client: không gọi được khi origin của baseUrl khác URL tuyệt đối", async () => {
    const f = fakeFetch(() => ({ body: [] }));
    const c = createGithubClient({ token: TOKEN, fetch: f.fn });
    await expect(
      c.list("https://evil.example/x", {}, z.array(z.any())),
    ).rejects.toMatchObject({ code: "client.bad_link" });
    expect(f.calls).toHaveLength(0);
  });
});
