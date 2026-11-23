CREATE TABLE "project_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_aliases_ws_key" UNIQUE("workspace_id","alias_key"),
	CONSTRAINT "project_aliases_alias_check" CHECK (length(btrim("project_aliases"."alias")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"conversation_id" uuid,
	"evidence_item_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_links_conversation" UNIQUE("project_id","conversation_id"),
	CONSTRAINT "project_links_evidence" UNIQUE("project_id","evidence_item_id"),
	CONSTRAINT "project_links_target_check" CHECK (("project_links"."target_type" = 'conversation' and "project_links"."conversation_id" is not null and "project_links"."evidence_item_id" is null)
        or ("project_links"."target_type" = 'evidence' and "project_links"."evidence_item_id" is not null and "project_links"."conversation_id" is null))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_ws_name_key" UNIQUE("workspace_id","name_key"),
	CONSTRAINT "projects_name_check" CHECK (length(btrim("projects"."name")) between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_evidence_item_id_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_aliases_project_idx" ON "project_aliases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_links_workspace_idx" ON "project_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "project_links_conversation_idx" ON "project_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "project_links_evidence_idx" ON "project_links" USING btree ("evidence_item_id");