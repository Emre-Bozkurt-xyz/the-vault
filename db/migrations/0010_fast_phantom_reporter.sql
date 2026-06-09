CREATE TABLE "document_collab_states" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"yjs_state" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_collab_states" ADD CONSTRAINT "document_collab_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
