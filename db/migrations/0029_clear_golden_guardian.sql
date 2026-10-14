CREATE TABLE "deployment_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"image_max_upload_bytes" bigint,
	"pdf_max_upload_bytes" bigint,
	"file_max_upload_bytes" bigint,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_settings_singleton" CHECK ("deployment_settings"."id")
);
--> statement-breakpoint
ALTER TABLE "deployment_settings" ADD CONSTRAINT "deployment_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;