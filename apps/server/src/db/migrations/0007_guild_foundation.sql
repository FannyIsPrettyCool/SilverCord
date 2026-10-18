CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"actor_id" bigint,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" bigint,
	"changes" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_reason_length" CHECK ("audit_log"."reason" is null or char_length("audit_log"."reason") <= 512)
);
--> statement-breakpoint
CREATE TABLE "guild_bans" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"reason" text,
	"banned_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_bans_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "guild_bans_reason_length" CHECK ("guild_bans"."reason" is null or char_length("guild_bans"."reason") <= 512)
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"nickname" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timeout_until" timestamp with time zone,
	"temporary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "guild_members_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "guild_members_nickname_length" CHECK ("guild_members"."nickname" is null or char_length("guild_members"."nickname") between 1 and 32)
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_name_length" CHECK (char_length("guilds"."name") between 1 and 100),
	CONSTRAINT "guilds_version_positive" CHECK ("guilds"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	CONSTRAINT "member_roles_guild_id_user_id_role_id_pk" PRIMARY KEY("guild_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigint PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"name" text NOT NULL,
	"color" integer,
	"icon" text,
	"permissions" bigint NOT NULL,
	"position" integer NOT NULL,
	"hoist" boolean DEFAULT false NOT NULL,
	"mentionable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_guild_id_unique" UNIQUE("guild_id","id"),
	-- Drizzle cannot model deferrability; preserve this for transactional reorders.
	CONSTRAINT "roles_guild_position_unique" UNIQUE("guild_id","position") DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "roles_name_length" CHECK (char_length("roles"."name") between 1 and 100),
	CONSTRAINT "roles_color_range" CHECK ("roles"."color" is null or "roles"."color" between 0 and 16777215),
	CONSTRAINT "roles_position_nonnegative" CHECK ("roles"."position" >= 0),
	CONSTRAINT "roles_permissions_nonnegative" CHECK ("roles"."permissions" >= 0),
	CONSTRAINT "roles_everyone_position" CHECK (("roles"."position" = 0) = ("roles"."id" = "roles"."guild_id")),
	CONSTRAINT "roles_icon_length" CHECK ("roles"."icon" is null or octet_length("roles"."icon") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_guild_role_fk" FOREIGN KEY ("guild_id","role_id") REFERENCES "public"."roles"("guild_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."guild_members"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_guild_idx" ON "audit_log" USING btree ("guild_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "guild_bans_user_idx" ON "guild_bans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guild_bans_banned_by_idx" ON "guild_bans" USING btree ("banned_by");--> statement-breakpoint
CREATE INDEX "guild_members_user_idx" ON "guild_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guilds_owner_idx" ON "guilds" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "member_roles_role_idx" ON "member_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "roles_guild_idx" ON "roles" USING btree ("guild_id");
