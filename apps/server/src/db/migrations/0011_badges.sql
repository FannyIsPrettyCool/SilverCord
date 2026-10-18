CREATE TABLE "badge_definitions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rarity" text NOT NULL,
	"icon_name" text,
	"icon_upload_id" bigint,
	"rule" jsonb,
	"retired" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_definitions_key_unique" UNIQUE("key"),
	CONSTRAINT "badge_definitions_name_length" CHECK (char_length("badge_definitions"."name") between 1 and 32),
	CONSTRAINT "badge_definitions_description_length" CHECK (char_length("badge_definitions"."description") <= 140),
	CONSTRAINT "badge_definitions_rarity_valid" CHECK ("badge_definitions"."rarity" in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
	CONSTRAINT "badge_definitions_one_icon" CHECK ("badge_definitions"."icon_name" is null or "badge_definitions"."icon_upload_id" is null)
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" bigint NOT NULL,
	"badge_id" bigint NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"awarded_by" bigint,
	"reason" text,
	"pin" smallint,
	CONSTRAINT "user_badges_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id"),
	CONSTRAINT "user_badges_pin_unique" UNIQUE("user_id","pin"),
	CONSTRAINT "user_badges_level_positive" CHECK ("user_badges"."level" >= 1),
	CONSTRAINT "user_badges_pin_range" CHECK ("user_badges"."pin" is null or "user_badges"."pin" between 0 and 5),
	CONSTRAINT "user_badges_reason_length" CHECK (char_length("user_badges"."reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD CONSTRAINT "badge_definitions_icon_upload_id_media_uploads_id_fk" FOREIGN KEY ("icon_upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badge_definitions_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badge_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_badges_badge_idx" ON "user_badges" USING btree ("badge_id");