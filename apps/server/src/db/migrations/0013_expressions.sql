CREATE TABLE "guild_emotes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"name" text NOT NULL,
	"upload_id" bigint NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_emotes_name_valid" CHECK ("guild_emotes"."name" ~ '^[A-Za-z0-9_]{2,32}$')
);
--> statement-breakpoint
CREATE TABLE "guild_stickers" (
	"id" bigint PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"related_emoji" text,
	"upload_id" bigint NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_stickers_name_length" CHECK (char_length("guild_stickers"."name") between 2 and 30),
	CONSTRAINT "guild_stickers_description_length" CHECK (char_length("guild_stickers"."description") <= 100)
);
--> statement-breakpoint
ALTER TABLE "guild_emotes" ADD CONSTRAINT "guild_emotes_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_emotes" ADD CONSTRAINT "guild_emotes_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_emotes" ADD CONSTRAINT "guild_emotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_stickers" ADD CONSTRAINT "guild_stickers_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_stickers" ADD CONSTRAINT "guild_stickers_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_stickers" ADD CONSTRAINT "guild_stickers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_emotes_guild_name_unique" ON "guild_emotes" USING btree ("guild_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "guild_emotes_upload_unique" ON "guild_emotes" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "guild_emotes_guild_idx" ON "guild_emotes" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_stickers_upload_unique" ON "guild_stickers" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "guild_stickers_guild_idx" ON "guild_stickers" USING btree ("guild_id");