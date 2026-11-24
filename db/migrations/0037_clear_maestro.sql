CREATE TABLE "asset_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"folder_id" uuid,
	"asset_id" uuid,
	"allow_download" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_share_links_one_target" CHECK (("asset_share_links"."folder_id" is null) <> ("asset_share_links"."asset_id" is null))
);
--> statement-breakpoint
ALTER TABLE "asset_share_links" ADD CONSTRAINT "asset_share_links_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_share_links" ADD CONSTRAINT "asset_share_links_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_share_links" ADD CONSTRAINT "asset_share_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_share_links_owner_id_idx" ON "asset_share_links" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_share_links_active_folder_unique" ON "asset_share_links" USING btree ("folder_id") WHERE "asset_share_links"."revoked_at" is null and "asset_share_links"."folder_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_share_links_active_asset_unique" ON "asset_share_links" USING btree ("asset_id") WHERE "asset_share_links"."revoked_at" is null and "asset_share_links"."asset_id" is not null;