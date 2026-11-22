CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_id" text,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_ws_idempotency" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "posts_status_check" CHECK ("posts"."status" in ('scheduled', 'publishing', 'published', 'failed')),
	CONSTRAINT "posts_attempts_check" CHECK ("posts"."attempts" >= 0),
	CONSTRAINT "posts_text_check" CHECK (length(btrim("posts"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_due_idx" ON "posts" USING btree ("status","scheduled_at");