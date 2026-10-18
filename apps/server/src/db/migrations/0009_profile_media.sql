ALTER TABLE "media_variants" DROP CONSTRAINT "media_variants_variant_valid";--> statement-breakpoint
ALTER TABLE "media_uploads" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "purpose" text DEFAULT 'attachment' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "guild_id" bigint;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "crop" jsonb;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD COLUMN "dominant_color" integer;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_uploads_guild_idx" ON "media_uploads" USING btree ("guild_id");--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_purpose_scope" CHECK (("media_uploads"."purpose" = 'attachment' and "media_uploads"."channel_id" is not null and "media_uploads"."guild_id" is null) or ("media_uploads"."purpose" in ('guild_avatar', 'guild_banner', 'emote', 'sticker') and "media_uploads"."guild_id" is not null and "media_uploads"."channel_id" is null) or ("media_uploads"."purpose" in ('avatar', 'banner', 'badge_icon') and "media_uploads"."channel_id" is null and "media_uploads"."guild_id" is null));--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_dominant_color_range" CHECK ("media_uploads"."dominant_color" is null or "media_uploads"."dominant_color" between 0 and 16777215);--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_variant_valid" CHECK ("media_variants"."variant" in ('display', 'thumbnail', 'download', 'still'));