CREATE TABLE "embed_boot_token_uses" (
	"jti" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embed_boot_token_uses" ADD CONSTRAINT "embed_boot_token_uses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embed_boot_token_uses_expires_at_idx" ON "embed_boot_token_uses" USING btree ("expires_at");