CREATE TABLE "document_snippets" (
	"document_id" uuid NOT NULL,
	"snippet_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_snippets_document_id_snippet_id_pk" PRIMARY KEY("document_id","snippet_id")
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_css" text DEFAULT '' NOT NULL,
	"compiled_css" text DEFAULT '' NOT NULL,
	"compiled_hash" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_snippets" ADD CONSTRAINT "document_snippets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snippets" ADD CONSTRAINT "document_snippets_snippet_id_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."snippets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_snippets_document_id_idx" ON "document_snippets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_snippets_snippet_id_idx" ON "document_snippets" USING btree ("snippet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snippets_owner_name_unique" ON "snippets" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "snippets_owner_id_idx" ON "snippets" USING btree ("owner_id");