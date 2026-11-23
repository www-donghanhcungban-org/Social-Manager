ALTER TABLE "evidence_items" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_items_message_idx" ON "evidence_items" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_message_check" CHECK (("evidence_items"."source" = 'message') = ("evidence_items"."message_id" is not null));