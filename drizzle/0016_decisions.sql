CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"source_evidence_item_id" uuid,
	"source_label" text NOT NULL,
	"superseded_by_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_status_check" CHECK ("decisions"."status" in ('active', 'superseded')),
	CONSTRAINT "decisions_text_check" CHECK (length(btrim("decisions"."text")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_source_evidence_item_id_evidence_items_id_fk" FOREIGN KEY ("source_evidence_item_id") REFERENCES "public"."evidence_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_project_idx" ON "decisions" USING btree ("project_id","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_workspace_idx" ON "decisions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "decisions_source_idx" ON "decisions" USING btree ("source_evidence_item_id");