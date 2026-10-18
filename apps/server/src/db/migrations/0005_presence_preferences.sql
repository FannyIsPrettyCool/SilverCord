CREATE TABLE "presence_preferences" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_preferences_status_valid" CHECK ("presence_preferences"."status" in ('online', 'idle', 'dnd', 'invisible'))
);
--> statement-breakpoint
ALTER TABLE "presence_preferences" ADD CONSTRAINT "presence_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;