ALTER TABLE "user_profiles" ADD COLUMN "activity_sources" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "manual_activity" jsonb;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "manual_activity_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "user_profiles_activity_expiry_idx" ON "user_profiles" USING btree ("manual_activity_expires_at") WHERE "user_profiles"."manual_activity_expires_at" is not null;