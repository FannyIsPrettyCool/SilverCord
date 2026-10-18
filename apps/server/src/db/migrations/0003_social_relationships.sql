CREATE TABLE "event_outbox" (
	"id" bigint PRIMARY KEY NOT NULL,
	"recipient_user_id" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "event_outbox_type_valid" CHECK ("event_outbox"."type" in ('RELATIONSHIPS_CHANGED', 'CHANNEL_CHANGED', 'MESSAGE_CHANGED', 'READ_STATE_CHANGED')),
	CONSTRAINT "event_outbox_attempts_positive" CHECK ("event_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "relationship_metadata" (
	"owner_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"nickname" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_metadata_owner_id_target_id_pk" PRIMARY KEY("owner_id","target_id"),
	CONSTRAINT "relationship_metadata_not_self" CHECK ("relationship_metadata"."owner_id" <> "relationship_metadata"."target_id"),
	CONSTRAINT "relationship_metadata_nickname_length" CHECK ("relationship_metadata"."nickname" is null or char_length("relationship_metadata"."nickname") between 1 and 32),
	CONSTRAINT "relationship_metadata_note_length" CHECK ("relationship_metadata"."note" is null or char_length("relationship_metadata"."note") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "relationship_pairs" (
	"id" bigint NOT NULL,
	"user_low" bigint NOT NULL,
	"user_high" bigint NOT NULL,
	"state" text DEFAULT 'none' NOT NULL,
	"requested_by" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_pairs_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "relationship_pairs_id_unique" UNIQUE("id"),
	CONSTRAINT "relationship_pairs_ordered" CHECK ("relationship_pairs"."user_low" < "relationship_pairs"."user_high"),
	CONSTRAINT "relationship_pairs_state_valid" CHECK ("relationship_pairs"."state" in ('none', 'pending', 'friends')),
	CONSTRAINT "relationship_pairs_request_valid" CHECK (("relationship_pairs"."state" = 'pending' and "relationship_pairs"."requested_by" is not null and "relationship_pairs"."requested_by" in ("relationship_pairs"."user_low", "relationship_pairs"."user_high")) or ("relationship_pairs"."state" <> 'pending' and "relationship_pairs"."requested_by" is null)),
	CONSTRAINT "relationship_pairs_version_positive" CHECK ("relationship_pairs"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_privacy" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"friend_requests" text DEFAULT 'everyone' NOT NULL,
	"direct_messages" text DEFAULT 'friends' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_privacy_requests_valid" CHECK ("social_privacy"."friend_requests" in ('everyone', 'nobody')),
	CONSTRAINT "social_privacy_messages_valid" CHECK ("social_privacy"."direct_messages" in ('friends', 'nobody')),
	CONSTRAINT "social_privacy_version_positive" CHECK ("social_privacy"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_owner_target_unique" UNIQUE("owner_id","target_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."owner_id" <> "user_blocks"."target_id")
);
--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_metadata" ADD CONSTRAINT "relationship_metadata_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_metadata" ADD CONSTRAINT "relationship_metadata_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_pairs" ADD CONSTRAINT "relationship_pairs_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_pairs" ADD CONSTRAINT "relationship_pairs_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_privacy" ADD CONSTRAINT "social_privacy_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_outbox_recipient_idx" ON "event_outbox" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("available_at","id") WHERE "event_outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "event_outbox_published_idx" ON "event_outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "relationship_metadata_target_idx" ON "relationship_metadata" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "relationship_pairs_low_id_idx" ON "relationship_pairs" USING btree ("user_low","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "relationship_pairs_high_id_idx" ON "relationship_pairs" USING btree ("user_high","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_blocks_target_owner_idx" ON "user_blocks" USING btree ("target_id","owner_id");--> statement-breakpoint
CREATE INDEX "user_blocks_owner_id_idx" ON "user_blocks" USING btree ("owner_id","id" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "social_privacy" ("user_id") SELECT "id" FROM "users" ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Every account has a stable social lock row, including registrations outside the HTTP service.
CREATE FUNCTION "create_user_social_privacy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "social_privacy" ("user_id") VALUES (NEW."id");
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_social_privacy" AFTER INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION "create_user_social_privacy"();
