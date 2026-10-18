CREATE TABLE "channel_overwrites" (
	"channel_id" bigint NOT NULL,
	"target_type" text NOT NULL,
	"target_id" bigint NOT NULL,
	"allow" bigint DEFAULT 0 NOT NULL,
	"deny" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_overwrites_channel_id_target_type_target_id_pk" PRIMARY KEY("channel_id","target_type","target_id"),
	CONSTRAINT "channel_overwrites_target_type" CHECK ("channel_overwrites"."target_type" in ('role', 'member')),
	CONSTRAINT "channel_overwrites_scope" CHECK ("channel_overwrites"."allow" >= 0 and "channel_overwrites"."deny" >= 0 and ("channel_overwrites"."allow" & ~406847487::bigint) = 0 and ("channel_overwrites"."deny" & ~406847487::bigint) = 0)
);
--> statement-breakpoint
ALTER TABLE "event_outbox" DROP CONSTRAINT "event_outbox_type_valid";--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT "channels_type_valid";--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "guild_id" bigint;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_id_guild_unique" UNIQUE("id","guild_id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_parent_guild_fk" FOREIGN KEY ("parent_id","guild_id") REFERENCES "public"."channels"("id","guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_guild_position_idx" ON "channels" USING btree ("guild_id","position");--> statement-breakpoint
CREATE INDEX "channels_parent_idx" ON "channels" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_type_valid" CHECK ("event_outbox"."type" in ('GUILD_CHANGED', 'GUILD_MEMBERS_CHANGED', 'RELATIONSHIPS_CHANGED', 'CHANNEL_CHANGED', 'MESSAGE_CHANGED', 'READ_STATE_CHANGED'));--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_guild_shape" CHECK (case when "channels"."type" in ('dm', 'group_dm') then "channels"."guild_id" is null and "channels"."parent_id" is null and "channels"."topic" is null and "channels"."position" = 0 and not "channels"."archived" else "channels"."guild_id" is not null and "channels"."owner_id" is null and "channels"."name" is not null end);--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_position_nonnegative" CHECK ("channels"."position" >= 0);--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_topic_length" CHECK ("channels"."topic" is null or char_length("channels"."topic") <= 1024);--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_archived_thread" CHECK (not "channels"."archived" or "channels"."type" = 'thread');--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_parent_shape" CHECK (("channels"."parent_id" is null or "channels"."parent_id" <> "channels"."id") and ("channels"."type" <> 'guild_category' or "channels"."parent_id" is null) and ("channels"."type" <> 'thread' or "channels"."parent_id" is not null));--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_type_valid" CHECK ("channels"."type" in ('dm', 'group_dm', 'guild_text', 'guild_voice', 'guild_category', 'announcement', 'thread'));
