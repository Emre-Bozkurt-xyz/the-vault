ALTER TABLE "assets" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "assets_status_trashed_at_idx" ON "assets" USING btree ("status","trashed_at");