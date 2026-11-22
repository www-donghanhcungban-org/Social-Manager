import { describe, expect, it } from "vitest";

import { listInbox, publishPost } from "@/src/providers/actions";
import { createDemoProvider } from "@/src/providers/demo";
import {
  CAPABILITIES,
  PLATFORMS,
  UnsupportedError,
  ValidationError,
  type SocialProvider,
} from "@/src/providers/types";

const NOW = new Date("2026-11-22T10:00:00.000Z");

/** Mọi provider có cài đặt thật phải qua bộ hợp đồng này (thêm provider = thêm một dòng). */
const providersUnderContract: [string, () => SocialProvider][] = [
  ["demo", () => createDemoProvider({ now: () => NOW })],
];

describe.each(providersUnderContract)(
  "hợp đồng provider: %s",
  (_name, make) => {
    it("từ chối (nền tảng, khả năng) mà provider không khai, bằng UnsupportedError có mã", async () => {
      const p = make();
      for (const platform of PLATFORMS) {
        for (const cap of CAPABILITIES) {
          if (p.support[platform]?.includes(cap)) continue;
          if (cap === "publish") {
            await expect(
              publishPost(p, { platform, accountId: "a", text: "x" }),
            ).rejects.toMatchObject({ code: "unsupported" });
          }
        }
      }
    });

    it("provider khai hỗ trợ thì phải cài đặt hành động tương ứng", () => {
      const p = make();
      const declares = (cap: (typeof CAPABILITIES)[number]) =>
        PLATFORMS.some((pl) => p.support[pl]?.includes(cap));
      if (declares("publish")) expect(p.publishPost).toBeTypeOf("function");
      if (
        declares("dm") ||
        declares("comments") ||
        declares("reviews") ||
        declares("mentions")
      ) {
        expect(p.listInbox).toBeTypeOf("function");
      }
    });

    it("listInbox trả mảng (có thể rỗng), mỗi mục đúng nền tảng và thời gian ISO UTC", async () => {
      const p = make();
      const items = await listInbox(p, {
        platform: "facebook",
        accountId: "acc1",
        kind: "comment",
      });
      expect(Array.isArray(items)).toBe(true);
      for (const it of items) {
        expect(it.platform).toBe("facebook");
        expect(it.kind).toBe("comment");
        expect(new Date(it.receivedAt).toISOString()).toBe(it.receivedAt);
      }
    });

    it("publishPost trả id và trạng thái published khi không hẹn giờ", async () => {
      const r = await publishPost(make(), {
        platform: "facebook",
        accountId: "a",
        text: "Xin chào",
      });
      expect(r.id).toBeTruthy();
      expect(r.status).toBe("published");
    });

    it("publishPost hẹn giờ trong tương lai trả scheduled", async () => {
      const r = await publishPost(make(), {
        platform: "facebook",
        accountId: "a",
        text: "Hẹn giờ",
        scheduledAt: "2026-11-23T08:00:00.000Z",
      });
      expect(r.status).toBe("scheduled");
    });

    it("từ chối nội dung rỗng hoặc chỉ khoảng trắng bằng ValidationError", async () => {
      for (const text of ["", "   ", "\n\t"]) {
        await expect(
          publishPost(make(), { platform: "facebook", accountId: "a", text }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it("từ chối giờ hẹn không phải ISO hợp lệ hoặc đã qua", async () => {
      for (const scheduledAt of [
        "không phải ngày",
        "2026-13-45T00:00:00Z",
        "2026-11-22T09:00:00.000Z",
      ]) {
        await expect(
          publishPost(make(), {
            platform: "facebook",
            accountId: "a",
            text: "x",
            scheduledAt,
          }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it("hai lần đăng cùng nội dung cho ra hai id khác nhau", async () => {
      const p = make();
      const a = await publishPost(p, {
        platform: "threads",
        accountId: "a",
        text: "x",
      });
      const b = await publishPost(p, {
        platform: "threads",
        accountId: "a",
        text: "x",
      });
      expect(a.id).not.toBe(b.id);
    });
  },
);

describe("actions với provider không hỗ trợ", () => {
  const noSupport: SocialProvider = { id: "none", label: "none", support: {} };

  it("publishPost ném UnsupportedError kèm nền tảng và khả năng", async () => {
    const err = await publishPost(noSupport, {
      platform: "telegram",
      accountId: "a",
      text: "x",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect(err).toMatchObject({
      code: "unsupported",
      platform: "telegram",
      capability: "publish",
    });
  });

  it("listInbox ném UnsupportedError, không trả mảng rỗng giả", async () => {
    await expect(
      listInbox(noSupport, {
        platform: "facebook",
        accountId: "a",
        kind: "dm",
      }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  it("khai hỗ trợ nhưng thiếu cài đặt thì báo not_implemented, không nuốt lỗi", async () => {
    const lazy: SocialProvider = {
      id: "lazy",
      label: "lazy",
      support: { facebook: ["publish"] },
    };
    await expect(
      publishPost(lazy, { platform: "facebook", accountId: "a", text: "x" }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });
});
