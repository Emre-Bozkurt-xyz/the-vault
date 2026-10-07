ALTER TABLE "document_tasks" ADD COLUMN "repeat" text;
--> statement-breakpoint
DELETE FROM "document_task_index";
