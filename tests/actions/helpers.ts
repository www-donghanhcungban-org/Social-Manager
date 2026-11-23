import { randomBytes } from "node:crypto";

import { vi } from "vitest";

import { createActionService } from "@/src/actions/ledger";
import { createDraftService } from "@/src/actions/drafts";
import {
  conversations,
  members,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import type {
  Page,
  ProviderMessage,
  SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

export const NOW = new Date("2026-11-22T12:00:00Z");
export const H = 3_600_000;

type Handler = NonNullable<SocialProvider["sendMessage"]>;
type Lister = NonNullable<SocialProvider["listMessages"]>;

export interface Env {
  t: Awaited<ReturnType<typeof createTestDb>>;
  ws: string;
  conv: string;
  account: string;
  state: { live: boolean; now: Date; provider: SocialProvider | undefined };
  send: ReturnType<typeof vi.fn<Handler>>;
  /** Đọc lại tin của hội thoại (đối soát): mặc định không có tin nào. */
  list: ReturnType<typeof vi.fn<Lister>>;
  actions: ReturnType<typeof createActionService>;
  drafts: ReturnType<typeof createDraftService>;
  /** Tạo nháp mới ở hội thoại chính và trả id. */
  draft(text?: string): Promise<string>;
  addMessage(over?: Partial<typeof messages.$inferInsert>): Promise<void>;
}

/** Dựng môi trường thử: workspace bật gửi, một hội thoại Facebook có tin đến 1 giờ trước, nhà cung cấp giả đếm lần gọi. */
export async function setup(
  opts: { platform?: string; outboundEnabled?: boolean } = {},
): Promise<Env> {
  const box = createSecretBox(randomBytes(32).toString("base64"));
  const t = await createTestDb();
  const [w] = await t.db
    .insert(workspaces)
    .values({ name: "A", outboundEnabled: opts.outboundEnabled ?? true })
    .returning();
  const ws = w!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner", role: "owner" },
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
  ]);
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "fake",
      label: "c",
      credentialsEnc: box.encrypt("KEY"),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: opts.platform ?? "facebook",
      externalId: "page-1",
      displayName: "Trang",
    })
    .returning();
  const [cv] = await t.db
    .insert(conversations)
    .values({
      workspaceId: ws,
      socialAccountId: a!.id,
      externalId: "conv-1",
      participantId: "psid",
      participantName: "Lan",
    })
    .returning();

  const send = vi.fn<Handler>(async () => ({ messageIds: ["sapi-1"] }));
  const list = vi.fn<Lister>(async (): Promise<Page<ProviderMessage>> => ({
    items: [],
    nextCursor: null,
  }));
  const state = {
    live: true,
    now: NOW,
    provider: {
      id: "fake",
      label: "Fake",
      support: { [opts.platform ?? "facebook"]: ["dm"] },
      sendMessage: send as Handler,
      listConversations: async () => ({ items: [], nextCursor: null }),
      listMessages: list as Lister,
    } as SocialProvider | undefined,
  };
  const actions = createActionService({
    db: t.db,
    box,
    resolveProvider: () => state.provider,
    live: () => state.live,
    now: () => state.now,
  });
  const drafts = createDraftService({ db: t.db, now: () => state.now });
  const env: Env = {
    t,
    ws,
    conv: cv!.id,
    account: a!.id,
    state,
    send,
    list,
    actions,
    drafts,
    async draft(text = "Dạ còn ạ") {
      return (
        await drafts.create({
          actorId: "member",
          workspaceId: ws,
          conversationId: cv!.id,
          text,
        })
      ).id;
    },
    async addMessage(over = {}) {
      await t.db.insert(messages).values({
        workspaceId: ws,
        conversationId: cv!.id,
        socialAccountId: a!.id,
        externalId: `m-${Math.random()}`,
        direction: "incoming",
        author: "Lan",
        text: "Còn hàng không?",
        sentAt: new Date(NOW.getTime() - H),
        ...over,
      });
    },
  };
  await env.addMessage();
  return env;
}
