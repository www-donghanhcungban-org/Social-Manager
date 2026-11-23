CREATE TABLE "action_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'send_message' NOT NULL,
	"state" text NOT NULL,
	"draft_id" uuid,
	"draft_version" integer NOT NULL,
	"conversation_id" uuid,
	"recipient_ref" text NOT NULL,
	"text_hash" text NOT NULL,
	"text_bytes" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"blocked_reason" text,
	"error_code" text,
	"provider_message_ids" text[],
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconcile_result" text,
	"resolved_by" text,
	CONSTRAINT "action_ledger_ws_key" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "action_ledger_state_check" CHECK ("action_ledger"."state" in ('queued', 'dispatching', 'confirmed', 'send_unknown', 'blocked', 'failed', 'cancel_requested', 'cancelled')),
	CONSTRAINT "action_ledger_kind_check" CHECK ("action_ledger"."kind" in ('send_message')),
	CONSTRAINT "action_ledger_attempts_check" CHECK ("action_ledger"."attempts" between 0 and 1),
	CONSTRAINT "action_ledger_hash_check" CHECK ("action_ledger"."text_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "action_ledger_code_check" CHECK (("action_ledger"."error_code" is null or "action_ledger"."error_code" ~ '^[A-Za-z0-9_.-]{1,64}$')
        and ("action_ledger"."blocked_reason" is null or "action_ledger"."blocked_reason" ~ '^[a-z_]{1,64}$')),
	CONSTRAINT "action_ledger_blocked_check" CHECK (("action_ledger"."state" = 'blocked') = ("action_ledger"."blocked_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "outbound_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "outbound_max_per_hour" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "action_ledger" ADD CONSTRAINT "action_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_ledger" ADD CONSTRAINT "action_ledger_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_ledger" ADD CONSTRAINT "action_ledger_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_ledger_draft_active" ON "action_ledger" USING btree ("draft_id") WHERE "action_ledger"."state" in ('queued', 'dispatching', 'cancel_requested', 'send_unknown', 'confirmed');--> statement-breakpoint
CREATE INDEX "action_ledger_state_idx" ON "action_ledger" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "action_ledger_ws_created_idx" ON "action_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "action_ledger_conversation_idx" ON "action_ledger" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_outbound_max_check" CHECK ("workspaces"."outbound_max_per_hour" between 0 and 1000);