CREATE TABLE "connector_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connector" text NOT NULL,
	"scope" text NOT NULL,
	"cursor" text,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_cursors_scope" UNIQUE("workspace_id","connector","scope"),
	CONSTRAINT "connector_cursors_code_check" CHECK ("connector_cursors"."last_error_code" is null or "connector_cursors"."last_error_code" ~ '^[A-Za-z0-9_.-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "connector_cursors" ADD CONSTRAINT "connector_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;