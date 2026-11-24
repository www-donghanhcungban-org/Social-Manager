import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import { loadEnv } from "@/src/config/env";
import {
  createGithubClient,
  GithubError,
} from "@/src/connectors/github/client";
import { SendRejectedError } from "@/src/providers/types";
import {
  createSocialApiClient,
  createSocialApiProvider,
  SocialApiError,
} from "@/src/providers/socialapi";

/**
 * SSRF lên các điểm gọi ra ngoài của server: (1) URL cấu hình qua biến môi trường, (2) client SocialAPI/GitHub gặp
 * phản hồi chuyển hướng (máy chủ thật trên 127.0.0.1, `fetch` thật của Node — không giả lập), (3) mã định danh từ nhà
 * cung cấp chứa đoạn chấm (`..`) bị trình phân tích URL chuẩn hoá thành đường dẫn khác trên cùng host.
 */

// ---------- (1) URL cấu hình qua env ----------

const baseEnv = () => ({
  DATABASE_URL: "postgres://app:mat-khau@db.internal:5432/x",
  BETTER_AUTH_SECRET: "s".repeat(48),
  BETTER_AUTH_URL: "https://x.example.com",
  APP_SECRET_KEY: randomBytes(32).toString("base64"),
});
const accepts = (over: Record<string, string>) => {
  try {
    loadEnv({ ...baseEnv(), ...over });
    return true;
  } catch {
    return false;
  }
};

/** Dải link-local (169.254.0.0/16, fe80::/10) — nơi đặt dịch vụ metadata đám mây; viết theo mọi dạng URL chuẩn hoá về. */
const LINK_LOCAL_HOSTS = [
  "169.254.169.254",
  "169.254.0.1",
  "2852039166", // 169.254.169.254 dạng thập phân
  "0xA9FEA9FE", // dạng hex
  "[fe80::1]",
  "[FE80::a:b]",
  "[febf::1]",
  "[::ffff:169.254.169.254]", // IPv4 ánh xạ IPv6
];

describe("SSRF qua URL cấu hình (biến môi trường)", () => {
  it("SOCIALAPI_BASE_URL: từ chối địa chỉ link-local/metadata đám mây ở mọi dạng viết, kể cả khi là https", () => {
    for (const h of LINK_LOCAL_HOSTS)
      expect(accepts({ SOCIALAPI_BASE_URL: `https://${h}/v1` }), h).toBe(false);
  });

  it("AI_BASE_URL: từ chối địa chỉ link-local/metadata đám mây (http lẫn https)", () => {
    for (const h of LINK_LOCAL_HOSTS)
      for (const scheme of ["http", "https"])
        expect(
          accepts({ AI_BASE_URL: `${scheme}://${h}/v1`, AI_MODEL: "m" }),
          `${scheme}://${h}`,
        ).toBe(false);
  });

  it("vẫn nhận điểm cuối hợp lệ: SocialAPI công khai và AI cục bộ (Ollama trên localhost là thiết kế, ADR-0005)", () => {
    expect(
      accepts({ SOCIALAPI_BASE_URL: "https://api.social-api.ai/v1" }),
    ).toBe(true);
    expect(
      accepts({ SOCIALAPI_BASE_URL: "https://169.254.example.com/v1" }),
    ).toBe(true);
    expect(
      accepts({ AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "m" }),
    ).toBe(true);
    expect(
      accepts({ AI_BASE_URL: "http://127.0.0.1:11434/v1", AI_MODEL: "m" }),
    ).toBe(true);
    expect(accepts({ AI_BASE_URL: "http://[fec0::1]/v1", AI_MODEL: "m" })).toBe(
      true,
    ); // ngoài fe80::/10
  });

  it("hành vi hiện tại (đặc tả): SOCIALAPI_BASE_URL vẫn nhận loopback/mạng riêng nếu là https — người vận hành có thể dùng proxy ra ngoài nội bộ", () => {
    for (const h of [
      "127.0.0.1",
      "localhost",
      "10.0.0.5",
      "192.168.1.10",
      "[::1]",
    ])
      expect(accepts({ SOCIALAPI_BASE_URL: `https://${h}/v1` }), h).toBe(true);
  });

  // Hành vi mong muốn CHƯA làm: chặn cả loopback/mạng riêng cho SocialAPI đổi cấu hình hợp lệ của người vận hành (proxy
  // ra ngoài trong mạng nội bộ) → chờ phiên chính quyết. Đỏ là đúng; khi được sửa, `it.fails` báo xanh để gỡ nhãn.
  it.fails(
    "mong muốn (chưa làm, chờ quyết định): SOCIALAPI_BASE_URL từ chối loopback và mạng riêng",
    () => {
      for (const h of [
        "127.0.0.1",
        "localhost",
        "10.0.0.5",
        "192.168.1.10",
        "[::1]",
      ])
        expect(accepts({ SOCIALAPI_BASE_URL: `https://${h}/v1` }), h).toBe(
          false,
        );
    },
  );
});

// ---------- (2) chuyển hướng ----------

interface Hit {
  path: string;
  auth: string | undefined;
}

/** Máy chủ HTTP thật trên 127.0.0.1; `handle` quyết phản hồi, mọi request được ghi lại. */
async function listen(
  handle: (req: IncomingMessage) => {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  },
) {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    hits.push({ path: req.url ?? "", auth: req.headers.authorization });
    const r = handle(req);
    res.writeHead(r.status, {
      "content-type": "application/json",
      ...r.headers,
    });
    res.end(r.body ?? "");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    hits,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

type Srv = Awaited<ReturnType<typeof listen>>;
let internal: Srv; // giả "dịch vụ nội bộ/metadata" — không được nhận bất kỳ request nào
let api: Srv; // "nhà cung cấp" bị chiếm/độc hại: trả 302 về dịch vụ nội bộ hoặc về đường dẫn khác cùng host

beforeAll(async () => {
  internal = await listen(() => ({
    status: 200,
    body: JSON.stringify({ data: [] }),
  }));
  api = await listen((req) => {
    if (req.url?.startsWith("/same-host-admin"))
      return { status: 200, body: JSON.stringify([]) };
    const to = req.url?.includes("same-host")
      ? "/same-host-admin"
      : `${internal.origin}/latest/meta-data/`;
    return { status: 302, headers: { location: to } };
  });
});
afterAll(async () => {
  await api.close();
  await internal.close();
});
beforeEach(() => {
  internal.hits.length = 0;
  api.hits.length = 0;
});

const caught = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};

describe("SSRF qua chuyển hướng: client SocialAPI không theo 302", () => {
  const client = () =>
    createSocialApiClient({
      apiKey: "KHOA-SOCIALAPI",
      baseUrl: `${api.origin}/v1`,
      maxRetries: 0,
    });

  it("302 sang máy khác (dịch vụ nội bộ) → báo lỗi mạng, máy nội bộ không nhận request nào", async () => {
    const e = await caught(client().get("/inbox/conversations", z.unknown()));
    expect(e).toBeInstanceOf(SocialApiError);
    expect((e as SocialApiError).code).toBe("client.network");
    expect(api.hits).toHaveLength(1);
    expect(internal.hits).toHaveLength(0);
  });

  it("302 sang đường dẫn khác cùng host cũng không được theo", async () => {
    const e = await caught(client().post("/same-host", {}, z.unknown()));
    expect((e as SocialApiError).code).toBe("client.network");
    expect(api.hits.map((h) => h.path)).toEqual(["/v1/same-host"]);
  });

  it('mỗi lời gọi đặt redirect: "error"', async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    await createSocialApiClient({ apiKey: "k", fetch: f }).get(
      "/x",
      z.unknown(),
    );
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("error");
  });
});

describe("SSRF qua chuyển hướng: client GitHub không theo 302", () => {
  const client = () =>
    createGithubClient({ token: "TOKEN-GITHUB", baseUrl: api.origin });

  it("302 sang máy khác (dịch vụ nội bộ) → báo lỗi mạng, máy nội bộ không nhận request nào, token không rời nguồn", async () => {
    const e = await caught(
      client().list("/repos/o/r/issues", {}, z.array(z.unknown())),
    );
    expect(e).toBeInstanceOf(GithubError);
    expect((e as GithubError).code).toBe("client.network");
    expect(api.hits).toHaveLength(1);
    expect(internal.hits).toHaveLength(0);
  });

  it("302 sang đường dẫn khác cùng host cũng không được theo", async () => {
    const e = await caught(
      client().list("/same-host", {}, z.array(z.unknown())),
    );
    expect((e as GithubError).code).toBe("client.network");
    expect(api.hits.map((h) => h.path)).toEqual(["/same-host"]);
  });

  it('mỗi lời gọi đặt redirect: "error"', async () => {
    const f = vi.fn(async () => new Response("[]", { status: 200 }));
    await createGithubClient({ token: "t", fetch: f }).list(
      "/repos/o/r/issues",
      {},
      z.array(z.unknown()),
    );
    const init = (f.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.redirect).toBe("error");
  });
});

// ---------- (3) đoạn chấm trong mã định danh ----------

describe("SSRF cùng host: mã định danh từ nhà cung cấp chứa đoạn chấm", () => {
  const BASE = "https://api.social-api.ai/v1";
  const setup = () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [], success: true, message_ids: [] }),
          { status: 200 },
        ),
    );
    return {
      f,
      p: createSocialApiProvider({ apiKey: "k", fetch: f, baseUrl: BASE }),
    };
  };

  it('encodeURIComponent không đủ: trình phân tích URL vẫn coi ".." là đoạn cha (cơ sở của lỗ hổng)', () => {
    expect(
      new URL(
        `${BASE}/inbox/conversations/${encodeURIComponent("..")}/messages`,
      ).pathname,
    ).toBe("/v1/inbox/messages");
  });

  it("listMessages với conversationId là đoạn chấm → từ chối, không gửi request nào", async () => {
    for (const id of ["..", "."]) {
      const { f, p } = setup();
      const e = await caught(
        p.listMessages!({
          platform: "instagram",
          accountId: "a",
          conversationId: id,
          cursor: undefined,
        }),
      );
      expect(e, id).toBeInstanceOf(SocialApiError);
      expect((e as SocialApiError).code, id).toBe("client.invalid_path");
      expect(f, id).not.toHaveBeenCalled();
    }
  });

  it('sendMessage với conversationId ".." → từ chối CHẮC CHẮN (chưa gửi gì, không phải send_unknown)', async () => {
    const { f, p } = setup();
    const e = await caught(
      p.sendMessage!({
        platform: "instagram",
        accountId: "a",
        conversationId: "..",
        text: "xin chào",
      }),
    );
    expect(e).toBeInstanceOf(SendRejectedError);
    expect((e as SendRejectedError).code).toBe("client.invalid_path");
    expect(f).not.toHaveBeenCalled();
  });

  it('getPostStatus với postId ".." → từ chối, không gửi request nào', async () => {
    const { f, p } = setup();
    const e = await caught(
      p.getPostStatus!({
        platform: "instagram",
        accountId: "a",
        postId: "..",
      }),
    );
    expect((e as SocialApiError).code).toBe("client.invalid_path");
    expect(f).not.toHaveBeenCalled();
  });

  it("client chặn cả đoạn chấm viết dạng %2e trong đường dẫn đã dựng (lớp phòng thủ cho mọi chỗ ghép đường dẫn)", async () => {
    for (const seg of ["%2e%2e", "%2E.", ".%2e", "%2e", ".."]) {
      const f = vi.fn();
      const c = createSocialApiClient({ apiKey: "k", fetch: f, baseUrl: BASE });
      const e = await caught(
        c.get(`/inbox/conversations/${seg}/x`, z.unknown()),
      );
      expect((e as SocialApiError).code, seg).toBe("client.invalid_path");
      expect(f, seg).not.toHaveBeenCalled();
    }
  });

  it("mã định danh bình thường có dấu chấm (hoặc chuỗi %2e được mã hoá) vẫn đi đúng một đoạn đường dẫn", async () => {
    for (const [id, seg] of [
      ["a.b", "a.b"],
      ["...", "..."],
      ["..a", "..a"],
      ["1.2.3", "1.2.3"],
      ["%2e%2e", "%252e%252e"],
      ["../admin", "..%2Fadmin"],
    ] as const) {
      const { f, p } = setup();
      await p.listMessages!({
        platform: "instagram",
        accountId: "a",
        conversationId: id,
        cursor: undefined,
      });
      const url = new URL(String((f.mock.calls[0] as unknown as [string])[0]));
      expect(url.pathname, id).toBe(`/v1/inbox/conversations/${seg}/messages`);
    }
  });
});
