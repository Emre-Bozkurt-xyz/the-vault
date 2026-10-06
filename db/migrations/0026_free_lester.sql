ALTER TABLE "document_tasks" ADD COLUMN "priority" text;
--> statement-breakpoint
-- Rebuild disposable task projections so unchanged documents gain priority.
DELETE FROM "document_task_index";
