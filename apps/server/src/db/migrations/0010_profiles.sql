CREATE TABLE "guild_member_profiles" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"avatar_upload_id" bigint,
	"banner_upload_id" bigint,
	"bio" text,
	"pronouns" text,
	"accent_color" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_member_profiles_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "guild_member_profiles_bio_length" CHECK (char_length("guild_member_profiles"."bio") <= 400),
	CONSTRAINT "guild_member_profiles_pronouns_length" CHECK (char_length("guild_member_profiles"."pronouns") between 1 and 40),
	CONSTRAINT "guild_member_profiles_accent_color" CHECK ("guild_member_profiles"."accent_color" is null or "guild_member_profiles"."accent_color" between 0 and 16777215)
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"bio" text,
	"pronouns" text,
	"accent_color" integer,
	"banner_color" integer,
	"theme_primary" integer,
	"theme_secondary" integer,
	"avatar_upload_id" bigint,
	"banner_upload_id" bigint,
	"custom_status_text" text,
	"custom_status_emoji" text,
	"custom_status_expires_at" timestamp with time zone,
	"privacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_bio_length" CHECK (char_length("user_profiles"."bio") <= 400),
	CONSTRAINT "user_profiles_pronouns_length" CHECK (char_length("user_profiles"."pronouns") between 1 and 40),
	CONSTRAINT "user_profiles_accent_color" CHECK ("user_profiles"."accent_color" is null or "user_profiles"."accent_color" between 0 and 16777215),
	CONSTRAINT "user_profiles_banner_color" CHECK ("user_profiles"."banner_color" is null or "user_profiles"."banner_color" between 0 and 16777215),
	CONSTRAINT "user_profiles_theme_primary" CHECK ("user_profiles"."theme_primary" is null or "user_profiles"."theme_primary" between 0 and 16777215),
	CONSTRAINT "user_profiles_theme_secondary" CHECK ("user_profiles"."theme_secondary" is null or "user_profiles"."theme_secondary" between 0 and 16777215),
	CONSTRAINT "user_profiles_theme_pair" CHECK (("user_profiles"."theme_primary" is null) = ("user_profiles"."theme_secondary" is null)),
	CONSTRAINT "user_profiles_custom_status_length" CHECK (char_length("user_profiles"."custom_status_text") <= 128),
	CONSTRAINT "user_profiles_version_positive" CHECK ("user_profiles"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "guild_member_profiles" ADD CONSTRAINT "guild_member_profiles_avatar_upload_id_media_uploads_id_fk" FOREIGN KEY ("avatar_upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_profiles" ADD CONSTRAINT "guild_member_profiles_banner_upload_id_media_uploads_id_fk" FOREIGN KEY ("banner_upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_profiles" ADD CONSTRAINT "guild_member_profiles_member_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."guild_members"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatar_upload_id_media_uploads_id_fk" FOREIGN KEY ("avatar_upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_banner_upload_id_media_uploads_id_fk" FOREIGN KEY ("banner_upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guild_member_profiles_user_idx" ON "guild_member_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_profiles_status_expiry_idx" ON "user_profiles" USING btree ("custom_status_expires_at") WHERE "user_profiles"."custom_status_expires_at" is not null;