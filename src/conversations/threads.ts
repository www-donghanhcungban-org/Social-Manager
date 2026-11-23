import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { view as actionView, type ActionView } from "../actions/ledger";
import type { DraftView } from "../actions/drafts";
import { requireAction, UUID } from "../auth/access";
import { NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  actionLedger,
  conversations,
  draftVersions,
  drafts,
  messages,
  socialAccounts,
} from "../db/schema";
import { ValidationError } from "../providers/types";

export interface ConversationSummary {
  id: string;
  accountId: string;
  accountName: string;
  platform: string;
  participantName: string;
  lastMessageAt: Date | null;
}

export interface ThreadMessage {
  id: string;
  direction: "incoming" | "outgoing";
  author: string;
  text: string;
  sentAt: Date;
}

export interface Thread {
  conversation: ConversationSummary;
  /** Tối đa `limit` tin MỚI NHẤT, xếp cũ → mới; `truncated` khi còn tin cũ hơn. */
  messages: ThreadMessage[];
  truncated: boolean;
  drafts: DraftView[];
  /** Hành động gửi của các nháp trong hội thoại, mới nhất trước. */
  actions: ActionView[];
}

const MAX_LIST = 100;
const MAX_THREAD = 200;
/** Mốc cho hội thoại chưa có tin: xếp cuối danh sách, vẫn so sánh được trong khoá phân trang. */
const EPOCH = new Date(0);

const clamp = (n: number | undefined, def: number, max: number) =>
  Math.min(Math.max(Math.trunc(n ?? def) || 1, 1), max);

/** Con trỏ `<ms>.<uuid>`: khoá (last_message_at, id) của dòng cuối trang trước. */
function parseCursor(c: string): { at: Date; id: string } {
  const m = /^(\d{1,15})\.([0-9a-f-]{36})$/i.exec(c);
  if (!m || !UUID.test(m[2]!))
    throw new ValidationError("Con trỏ không hợp lệ");
  return { at: new Date(Number(m[1])), id: m[2]! };
}

export function createThreadService({ db }: { db: Db }) {
  const lastAt = sql<Date>`coalesce(${conversations.lastMessageAt}, ${EPOCH.toISOString()}::timestamptz)`;

  const select = {
    id: conversations.id,
    accountId: conversations.socialAccountId,
    accountName: socialAccounts.displayName,
    platform: socialAccounts.platform,
    participantName: conversations.participantName,
    lastMessageAt: conversations.lastMessageAt,
  };

  return {
    /** Hội thoại của workspace, mới hoạt động nhất trước; không có tin thì cuối danh sách. */
    async list(input: {
      actorId: string;
      workspaceId: string;
      cursor?: string;
      limit?: number;
    }): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const limit = clamp(input.limit, 30, MAX_LIST);
      const cur =
        input.cursor === undefined ? undefined : parseCursor(input.cursor);
      const rows = await db
        .select({ ...select, sortAt: lastAt })
        .from(conversations)
        .innerJoin(
          socialAccounts,
          eq(conversations.socialAccountId, socialAccounts.id),
        )
        .where(
          and(
            eq(conversations.workspaceId, input.workspaceId),
            cur
              ? or(
                  lt(lastAt, cur.at),
                  and(eq(lastAt, cur.at), lt(conversations.id, cur.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(lastAt), desc(conversations.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(({ sortAt: _s, ...r }) => r),
        nextCursor:
          rows.length > limit && last
            ? `${new Date(last.sortAt).getTime()}.${last.id}`
            : null,
      };
    },

    /** Một cuộc trò chuyện kèm nháp và hành động gửi; id lạ hoặc workspace khác → NotFound. */
    async get(input: {
      actorId: string;
      workspaceId: string;
      conversationId: string;
      limit?: number;
    }): Promise<Thread> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      if (!UUID.test(input.conversationId)) throw new NotFoundError();
      const [conv] = await db
        .select(select)
        .from(conversations)
        .innerJoin(
          socialAccounts,
          eq(conversations.socialAccountId, socialAccounts.id),
        )
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.workspaceId, input.workspaceId),
          ),
        );
      if (!conv) throw new NotFoundError();

      const limit = clamp(input.limit, 100, MAX_THREAD);
      const rows = await db
        .select({
          id: messages.id,
          direction: messages.direction,
          author: messages.author,
          text: messages.text,
          sentAt: messages.sentAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.sentAt), desc(messages.id))
        .limit(limit + 1);

      const draftRows = await db
        .select({
          d: drafts,
          text: draftVersions.text,
          source: draftVersions.source,
        })
        .from(drafts)
        .innerJoin(
          draftVersions,
          and(
            eq(draftVersions.draftId, drafts.id),
            eq(draftVersions.version, drafts.currentVersion),
          ),
        )
        .where(
          and(
            eq(drafts.conversationId, conv.id),
            eq(drafts.workspaceId, input.workspaceId),
          ),
        )
        .orderBy(desc(drafts.updatedAt), desc(drafts.id));
      const draftViews: DraftView[] = draftRows.map(({ d, text, source }) => ({
        id: d.id,
        conversationId: d.conversationId,
        status: d.status,
        currentVersion: d.currentVersion,
        text,
        source,
        createdBy: d.createdBy,
        updatedAt: d.updatedAt,
      }));

      const actionRows =
        draftViews.length === 0
          ? []
          : await db
              .select()
              .from(actionLedger)
              .where(
                and(
                  eq(actionLedger.workspaceId, input.workspaceId),
                  inArray(
                    actionLedger.draftId,
                    draftViews.map((d) => d.id),
                  ),
                ),
              )
              .orderBy(desc(actionLedger.createdAt), asc(actionLedger.id));

      return {
        conversation: conv,
        messages: rows
          .slice(0, limit)
          .reverse()
          .map((m) => ({ ...m })),
        truncated: rows.length > limit,
        drafts: draftViews,
        actions: actionRows.map(actionView),
      };
    },
  };
}

export type ThreadService = ReturnType<typeof createThreadService>;
