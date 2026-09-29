CREATE TABLE "document_task_index" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"line" integer NOT NULL,
	"raw_line" text NOT NULL,
	"parent_ordinal" integer,
	"status" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"heading" text,
	"due_day" date,
	"due_time" text,
	"done_day" date
);
--> statement-breakpoint
ALTER TABLE "document_task_index" ADD CONSTRAINT "document_task_index_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tasks" ADD CONSTRAINT "document_tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_tasks_document_ordinal_idx" ON "document_tasks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_tasks_open_due_idx" ON "document_tasks" USING btree ("due_day") WHERE "document_tasks"."status" in ('open', 'in_progress');