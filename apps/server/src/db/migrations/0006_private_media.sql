CREATE TABLE "media_quota_usage" (
	"scope" text PRIMARY KEY NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"stored_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "media_quota_usage_nonnegative" CHECK ("media_quota_usage"."reserved_bytes" >= 0 and "media_quota_usage"."stored_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_upload_chunks" (
	"upload_id" bigint NOT NULL,
	"offset" bigint NOT NULL,
	"length" integer NOT NULL,
	"sha256" "bytea" NOT NULL,
	"storage_key" text NOT NULL,
	CONSTRAINT "media_upload_chunks_upload_id_offset_pk" PRIMARY KEY("upload_id","offset"),
	CONSTRAINT "media_upload_chunks_length_positive" CHECK ("media_upload_chunks"."length" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"stored_bytes" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"detected_mime" text,
	"kind" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"blurhash" text,
	"animated" boolean DEFAULT false NOT NULL,
	"failure" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_uploads_state_valid" CHECK ("media_uploads"."state" in ('uploading', 'processing', 'ready', 'attached', 'failed', 'deleting')),
	CONSTRAINT "media_uploads_filename_length" CHECK (char_length("media_uploads"."filename") between 1 and 128),
	CONSTRAINT "media_uploads_bytes_valid" CHECK ("media_uploads"."size_bytes" > 0 and "media_uploads"."received_bytes" between 0 and "media_uploads"."size_bytes" and "media_uploads"."reserved_bytes" >= 0 and "media_uploads"."stored_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"upload_id" bigint NOT NULL,
	"variant" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	CONSTRAINT "media_variants_upload_id_variant_pk" PRIMARY KEY("upload_id","variant"),
	CONSTRAINT "media_variants_variant_valid" CHECK ("media_variants"."variant" in ('display', 'thumbnail', 'download')),
	CONSTRAINT "media_variants_hash_hex" CHECK ("media_variants"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" bigint NOT NULL,
	"upload_id" bigint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_attachments_message_id_upload_id_pk" PRIMARY KEY("message_id","upload_id"),
	CONSTRAINT "message_attachments_uploadId_unique" UNIQUE("upload_id"),
	CONSTRAINT "message_attachments_position_range" CHECK ("message_attachments"."position" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "media_upload_chunks" ADD CONSTRAINT "media_upload_chunks_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_uploads_owner_state_idx" ON "media_uploads" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "media_uploads_channel_idx" ON "media_uploads" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "media_uploads_state_expiry_idx" ON "media_uploads" USING btree ("state","expires_at");