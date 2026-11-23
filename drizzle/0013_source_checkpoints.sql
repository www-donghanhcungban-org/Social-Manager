CREATE TABLE "source_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_checkpoints_account" UNIQUE("social_account_id"),
	CONSTRAINT "source_checkpoints_failures_check" CHECK ("source_checkpoints"."consecutive_failures" >= 0),
	CONSTRAINT "source_checkpoints_code_check" CHECK ("source_checkpoints"."last_error_code" is null or "source_checkpoints"."last_error_code" ~ '^[A-Za-z0-9_.-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "source_checkpoints" ADD CONSTRAINT "source_checkpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_checkpoints" ADD CONSTRAINT "source_checkpoints_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_checkpoints_workspace_idx" ON "source_checkpoints" USING btree ("workspace_id");