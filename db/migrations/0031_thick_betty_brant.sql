ALTER TABLE "deployment_settings" ADD COLUMN "asset_maintenance_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployment_settings" ADD COLUMN "asset_maintenance_ran_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployment_settings" ADD COLUMN "asset_maintenance_result" jsonb;