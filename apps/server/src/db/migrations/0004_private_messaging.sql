CREATE TABLE "channel_members" (
	"channel_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" bigint PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"owner_id" bigint,
	"name" text,
	"version" integer DEFAULT 1 NOT NULL,
	"last_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_type_valid" CHECK ("channels"."type" in ('dm', 'group_dm')),
	CONSTRAINT "channels_name_length" CHECK ("channels"."name" is null or char_length("channels"."name") between 1 and 100),
	CONSTRAINT "channels_dm_shape" CHECK ("channels"."type" <> 'dm' or ("channels"."owner_id" is null and "channels"."name" is null)),
	CONSTRAINT "channels_version_positive" CHECK ("channels"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "dm_pairs" (
	"user_low" bigint NOT NULL,
	"user_high" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	CONSTRAINT "dm_pairs_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "dm_pairs_channelId_unique" UNIQUE("channel_id"),
	CONSTRAINT "dm_pairs_ordered" CHECK ("dm_pairs"."user_low" < "dm_pairs"."user_high")
);
--> statement-breakpoint
CREATE TABLE "message_idempotency" (
	"author_id" bigint NOT NULL,
	"key" uuid NOT NULL,
	"channel_id" bigint NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"message_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_idempotency_author_id_key_pk" PRIMARY KEY("author_id","key")
);
--> statement-breakpoint
CREATE TABLE "message_mentions" (
	"message_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	CONSTRAINT "message_mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji"),
	CONSTRAINT "message_reactions_emoji_length" CHECK (octet_length("message_reactions"."emoji") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY NOT NULL,
	"channel_id" bigint NOT NULL,
	"author_id" bigint,
	"content" text NOT NULL,
	"reply_to_id" bigint,
	"is_reply" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "messages_channel_id_unique" UNIQUE("channel_id","id"),
	CONSTRAINT "messages_version_positive" CHECK ("messages"."version" > 0),
	CONSTRAINT "messages_reply_flag" CHECK ("messages"."reply_to_id" is null or "messages"."is_reply")
);
--> statement-breakpoint
CREATE TABLE "read_states" (
	"user_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"last_read_message_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "read_states_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_pairs" ADD CONSTRAINT "dm_pairs_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_pairs" ADD CONSTRAINT "dm_pairs_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_pairs" ADD CONSTRAINT "dm_pairs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_idempotency" ADD CONSTRAINT "message_idempotency_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_states" ADD CONSTRAINT "read_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_states" ADD CONSTRAINT "read_states_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_members_user_channel_idx" ON "channel_members" USING btree ("user_id","channel_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "channels_owner_idx" ON "channels" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "dm_pairs_high_idx" ON "dm_pairs" USING btree ("user_high");--> statement-breakpoint
CREATE INDEX "message_idempotency_message_idx" ON "message_idempotency" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_mentions_user_message_idx" ON "message_mentions" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_channel_id_idx" ON "messages" USING btree ("channel_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "read_states_channel_idx" ON "read_states" USING btree ("channel_id");--> statement-breakpoint
-- Replies stay inside their channel; deleting the target nulls only reply_to_id (PG 15+).
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_same_channel_fk" FOREIGN KEY ("channel_id","reply_to_id") REFERENCES "public"."messages"("channel_id","id") ON DELETE SET NULL ("reply_to_id") ON UPDATE no action;
