ALTER TABLE "workspaces" ADD COLUMN "inbox_retention_days" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "retain_inbox_forever" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_retention_days_check" CHECK ("workspaces"."inbox_retention_days" is null or "workspaces"."inbox_retention_days" between 1 and 36500);