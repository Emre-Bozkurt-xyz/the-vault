CREATE TABLE "asset_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"trashed_at" timestamp with time zone,
	"trashed_via_folder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trashed_via_folder_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_parent_id_asset_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_trashed_via_folder_id_asset_folders_id_fk" FOREIGN KEY ("trashed_via_folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_folders_owner_id_idx" ON "asset_folders" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "asset_folders_parent_id_idx" ON "asset_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "asset_folders_trashed_via_idx" ON "asset_folders" USING btree ("trashed_via_folder_id");--> statement-breakpoint
CREATE INDEX "asset_folders_status_trashed_at_idx" ON "asset_folders" USING btree ("status","trashed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_folders_live_sibling_name_unique" ON "asset_folders" USING btree ("owner_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "asset_folders"."status" = 'active';--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_trashed_via_folder_id_asset_folders_id_fk" FOREIGN KEY ("trashed_via_folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_folder_id_idx" ON "assets" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "assets_trashed_via_folder_id_idx" ON "assets" USING btree ("trashed_via_folder_id");