CREATE TABLE "evidence_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_blobs_ws_sha" UNIQUE("workspace_id","sha256"),
	CONSTRAINT "evidence_blobs_sha_check" CHECK ("evidence_blobs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_blobs_size_check" CHECK ("evidence_blobs"."size_bytes" > 0),
	CONSTRAINT "evidence_blobs_type_check" CHECK ("evidence_blobs"."content_type" in ('text/plain', 'text/markdown', 'application/json'))
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"blob_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_source_external_blob" UNIQUE("workspace_id","source","external_id","blob_id"),
	CONSTRAINT "evidence_items_source_check" CHECK ("evidence_items"."source" in ('message', 'document', 'github')),
	CONSTRAINT "evidence_items_external_check" CHECK (length("evidence_items"."external_id") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "evidence_blobs" ADD CONSTRAINT "evidence_blobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_blob_id_evidence_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."evidence_blobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_items_blob_idx" ON "evidence_items" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "evidence_items_ws_observed_idx" ON "evidence_items" USING btree ("workspace_id","observed_at");