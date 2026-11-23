CREATE TABLE "draft_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_versions_draft_version" UNIQUE("draft_id","version"),
	CONSTRAINT "draft_versions_version_check" CHECK ("draft_versions"."version" >= 1),
	CONSTRAINT "draft_versions_source_check" CHECK ("draft_versions"."source" in ('human', 'ai')),
	CONSTRAINT "draft_versions_text_check" CHECK (length(btrim("draft_versions"."text")) between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_status_check" CHECK ("drafts"."status" in ('open', 'sent', 'discarded')),
	CONSTRAINT "drafts_version_check" CHECK ("drafts"."current_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_versions_workspace_idx" ON "draft_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "drafts_conversation_idx" ON "drafts" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE INDEX "drafts_workspace_idx" ON "drafts" USING btree ("workspace_id");