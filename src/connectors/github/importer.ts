import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAction } from "../../auth/access";
import type { Db } from "../../auth/members";
import { connectorCursors } from "../../db/schema";
import type { EvidenceService } from "../../evidence/service";
import { ValidationError } from "../../providers/types";
import {
  createGithubClient,
  GithubError,
  type GithubClient,
  type GithubClientOptions,
} from "./client";

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PER_PAGE = 100;
const MAX_REVIEW_PAGES = 3;

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)));
const IssueList = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullish(),
    state: z.string(),
    user: z.object({ login: z.string() }).nullish(),
    labels: z
      .array(z.union([z.string(), z.object({ name: z.string().nullish() })]))
      .default([]),
    created_at: iso,
    updated_at: iso,
    html_url: z.string(),
    pull_request: z.object({}).passthrough().optional(),
  }),
);
const ReviewList = z.array(
  z.object({
    id: z.number().int().positive(),
    state: z.string(),
    body: z.string().nullish(),
    user: z.object({ login: z.string() }).nullish(),
    submitted_at: iso.nullish(),
    html_url: z.string().nullish(),
  }),
);

export interface GithubImportResult {
  /** `complete`: hết dữ liệu mới · `partial`: chạm trần trang, lượt sau đọc tiếp · `rate_limited`: dừng vì hết hạn mức. */
  status: "complete" | "partial" | "rate_limited";
  issues: number;
  pullRequests: number;
  reviews: number;
  /** Lần nhập là nội dung mới (bản mới của mục đã có cũng tính). */
  newVersions: number;
  /** Với `rate_limited`: được gọi lại từ lúc này (ISO) nếu GitHub cho biết. */
  retryAt: string | null;
  /** Mốc `updated_at` đã xử lý tới; lượt sau chỉ hỏi từ đây. */
  cursor: string | null;
}

/**
 * Nhập issue, pull request và review của một repo vào kho bằng chứng, theo con trỏ `updated_at` (GitHub không tự gửi lại
 * webhook nên nhập bằng API có con trỏ — research §4). Lũy đẳng: cùng nội dung không nhân đôi; mục bị sửa thành phiên bản
 * mới. Dừng ngay khi hết hạn mức, không đốt thêm lượt.
 */
export function createGithubImporter({
  db,
  evidence,
  now = () => new Date(),
  clientFactory = (o: GithubClientOptions) => createGithubClient(o),
  fetchImpl,
}: {
  db: Db;
  evidence: Pick<EvidenceService, "ingestAsSystem">;
  now?: () => Date;
  clientFactory?: (o: GithubClientOptions) => GithubClient;
  fetchImpl?: typeof fetch;
}) {
  async function readCursor(workspaceId: string, scope: string) {
    const [row] = await db
      .select({ cursor: connectorCursors.cursor })
      .from(connectorCursors)
      .where(
        and(
          eq(connectorCursors.workspaceId, workspaceId),
          eq(connectorCursors.connector, "github"),
          eq(connectorCursors.scope, scope),
        ),
      );
    return row?.cursor ?? null;
  }

  async function saveCursor(
    workspaceId: string,
    scope: string,
    cursor: string | null,
    errorCode: string | null,
  ) {
    const at = now();
    await db
      .insert(connectorCursors)
      .values({
        workspaceId,
        connector: "github",
        scope,
        cursor,
        lastRunAt: at,
        lastErrorCode: errorCode,
      })
      .onConflictDoUpdate({
        target: [
          connectorCursors.workspaceId,
          connectorCursors.connector,
          connectorCursors.scope,
        ],
        // Không lùi con trỏ khi lượt này không xử lý được mục nào.
        set: {
          cursor: cursor ?? undefined,
          lastRunAt: at,
          lastErrorCode: errorCode,
        },
      });
  }

  return {
    /**
     * Nhập một repo. `token` do người gọi cấp (không lưu, không log). Cần quyền ghi kho. Lỗi không phải hạn mức (token
     * sai, repo không thấy, mạng) được ném ra với mã an toàn sau khi ghi mã đó vào con trỏ.
     */
    async importRepo(input: {
      actorId: string;
      workspaceId: string;
      owner: string;
      repo: string;
      token: string;
      /** Trần số trang issue mỗi lượt (mặc định 10 × 100 mục). */
      maxPages?: number;
    }): Promise<GithubImportResult> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.write",
      );
      if (!NAME.test(input.owner) || !NAME.test(input.repo))
        throw new ValidationError("Tên chủ sở hữu/repo GitHub không hợp lệ");
      const maxPages = input.maxPages ?? 10;
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
        throw new ValidationError("Trần số trang phải là số nguyên 1-100");
      const slug = `${input.owner}/${input.repo}`;
      const scope = slug.toLowerCase();
      const client = clientFactory({
        token: input.token,
        fetch: fetchImpl,
        now: () => now().getTime(),
      });

      const result: GithubImportResult = {
        status: "complete",
        issues: 0,
        pullRequests: 0,
        reviews: 0,
        newVersions: 0,
        retryAt: null,
        cursor: await readCursor(input.workspaceId, scope),
      };
      const ingest = async (
        externalId: string,
        payload: unknown,
        observedAt: Date,
      ) => {
        const r = await evidence.ingestAsSystem({
          workspaceId: input.workspaceId,
          source: "github",
          externalId,
          content: JSON.stringify(payload),
          contentType: "application/json",
          observedAt,
        });
        if (!r.duplicate) result.newVersions++;
      };

      try {
        let next: string | null = null;
        for (let page = 0; page < maxPages; page++) {
          const res: Awaited<
            ReturnType<typeof client.list<z.infer<typeof IssueList>[number]>>
          > = await client.list(
            next ?? `/repos/${slug}/issues`,
            {
              state: "all",
              since: result.cursor ?? undefined,
              sort: "updated",
              direction: "asc",
              per_page: PER_PAGE,
            },
            IssueList,
          );
          for (const it of res.items) {
            const isPr = it.pull_request !== undefined;
            const updated = new Date(it.updated_at);
            await ingest(
              `${slug}#${it.number}`,
              {
                kind: isPr ? "pull_request" : "issue",
                number: it.number,
                title: it.title,
                body: it.body ?? "",
                state: it.state,
                author: it.user?.login ?? null,
                labels: it.labels.map((l) =>
                  typeof l === "string" ? l : (l.name ?? ""),
                ),
                createdAt: it.created_at,
                updatedAt: it.updated_at,
                url: it.html_url,
              },
              updated,
            );
            if (isPr) {
              result.pullRequests++;
              await importReviews(it.number);
            } else result.issues++;
            // Tăng dần theo updated_at nên mốc chỉ tiến lên khi mục đã xử lý xong.
            result.cursor = it.updated_at;
          }
          next = res.next;
          if (next === null) break;
          if (page === maxPages - 1) result.status = "partial";
        }
      } catch (e) {
        if (e instanceof GithubError && e.code === "rate_limited") {
          result.status = "rate_limited";
          result.retryAt =
            e.resetAtMs === undefined
              ? null
              : new Date(e.resetAtMs).toISOString();
          await saveCursor(
            input.workspaceId,
            scope,
            result.cursor,
            "rate_limited",
          );
          return result;
        }
        const code = e instanceof GithubError ? e.code : "internal";
        await saveCursor(input.workspaceId, scope, result.cursor, code);
        throw e;
      }
      await saveCursor(input.workspaceId, scope, result.cursor, null);
      return result;

      async function importReviews(number: number) {
        let rnext: string | null = null;
        for (let p = 0; p < MAX_REVIEW_PAGES; p++) {
          const res: Awaited<
            ReturnType<typeof client.list<z.infer<typeof ReviewList>[number]>>
          > = await client.list(
            rnext ?? `/repos/${slug}/pulls/${number}/reviews`,
            { per_page: PER_PAGE },
            ReviewList,
          );
          for (const rv of res.items) {
            // Review chưa gửi (PENDING) chưa có thời điểm và chưa phải bằng chứng.
            if (!rv.submitted_at) continue;
            await ingest(
              `${slug}#${number}/review/${rv.id}`,
              {
                kind: "review",
                pullRequest: number,
                state: rv.state,
                body: rv.body ?? "",
                author: rv.user?.login ?? null,
                submittedAt: rv.submitted_at,
                url: rv.html_url ?? null,
              },
              new Date(rv.submitted_at),
            );
            result.reviews++;
          }
          rnext = res.next;
          if (rnext === null) break;
        }
      }
    },
  };
}

export type GithubImporter = ReturnType<typeof createGithubImporter>;
