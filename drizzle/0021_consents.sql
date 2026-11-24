CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"ui_snapshot_hash" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_purpose_check" CHECK ("consents"."purpose_id" in ('ai_cloud')),
	CONSTRAINT "consents_hash_check" CHECK ("consents"."ui_snapshot_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "consents_withdrawn_after_granted_check" CHECK ("consents"."withdrawn_at" is null or "consents"."withdrawn_at" >= "consents"."granted_at")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_ws_purpose_created_idx" ON "consents" USING btree ("workspace_id","purpose_id","created_at");--> statement-breakpoint
CREATE INDEX "consents_subject_idx" ON "consents" USING btree ("subject_id");--> statement-breakpoint
-- Dựng bản ghi đồng ý cho workspace đã bật AI đám mây trước khi có bảng này (kênh `migration`, một owner làm chủ thể);
-- không có thì cổng AI sẽ chặn đột ngột. Workspace không còn owner thì không dựng (xử lý như chưa đồng ý).
INSERT INTO "consents" ("workspace_id", "subject_id", "purpose_id", "policy_version", "granted_at", "channel", "ui_snapshot_hash")
SELECT w."id", m."user_id", 'ai_cloud', 'pre-consent-record', now(), 'migration', encode(sha256('migration-backfill'::bytea), 'hex')
FROM "workspaces" w
JOIN LATERAL (
	SELECT mm."user_id" FROM "members" mm
	WHERE mm."workspace_id" = w."id" AND mm."role" = 'owner'
	ORDER BY mm."created_at" LIMIT 1
) m ON true
WHERE w."ai_cloud_enabled" = true;