CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"uploader_id" uuid,
	"storage_driver" text DEFAULT 'r2' NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"alt_text" text,
	"mime_type" text NOT NULL,
	"detected_mime_type" text NOT NULL,
	"file_extension" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "storage_quota_bytes" bigint DEFAULT 268435456 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_id_idx" ON "assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "assets_visibility_status_idx" ON "assets" USING btree ("visibility","status");--> statement-breakpoint
CREATE INDEX "assets_created_at_idx" ON "assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assets_deleted_at_idx" ON "assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_key_unique" ON "assets" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_assets_document_asset_unique" ON "document_assets" USING btree ("document_id","asset_id");--> statement-breakpoint
CREATE INDEX "document_assets_document_id_idx" ON "document_assets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_assets_asset_id_idx" ON "document_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "document_assets_linked_by_idx" ON "document_assets" USING btree ("linked_by");