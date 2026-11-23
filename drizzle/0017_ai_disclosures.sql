CREATE TABLE "ai_disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"purpose" text NOT NULL,
	"endpoint_host" text NOT NULL,
	"model" text NOT NULL,
	"local" boolean NOT NULL,
	"item_count" integer NOT NULL,
	"bytes_sent" integer NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_disclosures_status_check" CHECK ("ai_disclosures"."status" in ('sent', 'ok', 'error', 'blocked')),
	CONSTRAINT "ai_disclosures_counts_check" CHECK ("ai_disclosures"."item_count" >= 0 and "ai_disclosures"."bytes_sent" >= 0),
	CONSTRAINT "ai_disclosures_code_check" CHECK ("ai_disclosures"."error_code" is null or "ai_disclosures"."error_code" ~ '^[A-Za-z0-9_.-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ai_cloud_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_disclosures" ADD CONSTRAINT "ai_disclosures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_disclosures_ws_created_idx" ON "ai_disclosures" USING btree ("workspace_id","created_at");