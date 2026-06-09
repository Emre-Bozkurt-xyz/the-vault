CREATE TABLE "document_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text DEFAULT 'members' NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_share_links" ADD CONSTRAINT "document_share_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_share_links" ADD CONSTRAINT "document_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_share_links_token_hash_unique" ON "document_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "document_share_links_document_id_idx" ON "document_share_links" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_share_links_enabled_idx" ON "document_share_links" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "document_share_links_expires_at_idx" ON "document_share_links" USING btree ("expires_at");