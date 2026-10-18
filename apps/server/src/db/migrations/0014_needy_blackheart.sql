ALTER TABLE "event_outbox" ALTER COLUMN "recipient_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "scope_channel_id" bigint;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_scope_channel_id_channels_id_fk" FOREIGN KEY ("scope_channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_outbox_scope_idx" ON "event_outbox" USING btree ("scope_channel_id");--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_scope" CHECK (("event_outbox"."recipient_user_id" is null) <> ("event_outbox"."scope_channel_id" is null));