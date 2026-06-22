CREATE TABLE "document_extension_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"state_key" text DEFAULT 'default' NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_extension_states" ADD CONSTRAINT "document_extension_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extension_states" ADD CONSTRAINT "document_extension_states_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extension_states" ADD CONSTRAINT "document_extension_states_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_extension_states_document_key_unique" ON "document_extension_states" USING btree ("document_id","extension_id","state_key");--> statement-breakpoint
CREATE INDEX "document_extension_states_document_id_idx" ON "document_extension_states" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_extension_states_extension_id_idx" ON "document_extension_states" USING btree ("extension_id");--> statement-breakpoint
CREATE INDEX "document_extension_states_visibility_idx" ON "document_extension_states" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "document_extension_states_deleted_at_idx" ON "document_extension_states" USING btree ("deleted_at");