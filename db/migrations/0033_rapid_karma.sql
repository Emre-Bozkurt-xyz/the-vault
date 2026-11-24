ALTER TABLE "assets" ADD COLUMN "rendition_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "rendition_version" integer;