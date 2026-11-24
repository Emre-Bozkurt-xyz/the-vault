CREATE TABLE "user_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"storage_quota_bytes" bigint NOT NULL,
	"unrestricted_uploads_allowed" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "storage_quota_override_bytes" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "unrestricted_uploads_override" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "user_tiers_name_unique" ON "user_tiers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_tiers_one_default" ON "user_tiers" USING btree ("is_default") WHERE "user_tiers"."is_default";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tier_id_user_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."user_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_tier_id_idx" ON "users" USING btree ("tier_id");--> statement-breakpoint
-- Backfill: one default "Standard" tier whose quota is the most common quota
-- among existing users (ties: the larger; no users: 50 MiB, the old built-in
-- default), without unrestricted uploads. Everyone follows it (tier_id stays
-- null). A user whose quota differs from it, or who had the grant, was set
-- apart by an admin, so that value becomes their own override. The old
-- columns drop in 0039.
INSERT INTO "user_tiers" ("name", "storage_quota_bytes", "unrestricted_uploads_allowed", "is_default")
SELECT 'Standard', coalesce((SELECT "storage_quota_bytes" FROM "users" GROUP BY "storage_quota_bytes" ORDER BY count(*) DESC, "storage_quota_bytes" DESC LIMIT 1), 52428800), false, true;--> statement-breakpoint
UPDATE "users" SET "storage_quota_override_bytes" = "storage_quota_bytes" WHERE "storage_quota_bytes" <> (SELECT "storage_quota_bytes" FROM "user_tiers" WHERE "is_default");--> statement-breakpoint
UPDATE "users" SET "unrestricted_uploads_override" = true WHERE "unrestricted_uploads_allowed";
