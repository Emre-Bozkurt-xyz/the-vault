CREATE TABLE "asset_uploads" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"upload_id" text NOT NULL,
	"part_size_bytes" bigint NOT NULL,
	"part_count" integer NOT NULL,
	"allow_any_file_type" boolean NOT NULL,
	"document_id" uuid,
	"share_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_uploads" ADD CONSTRAINT "asset_uploads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_uploads_user_id_idx" ON "asset_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_uploads_expires_at_idx" ON "asset_uploads" USING btree ("expires_at");