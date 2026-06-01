ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_name_idx" ON "users" USING btree ("name");
