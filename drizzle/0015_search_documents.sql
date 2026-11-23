CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"evidence_item_id" uuid NOT NULL,
	"text_folded" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_documents_item" UNIQUE("evidence_item_id")
);
--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_evidence_item_id_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_documents_fts_idx" ON "search_documents" USING gin (to_tsvector('simple', "text_folded"));--> statement-breakpoint
CREATE INDEX "search_documents_workspace_idx" ON "search_documents" USING btree ("workspace_id");