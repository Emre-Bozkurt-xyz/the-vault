ALTER TABLE "official_docs" ADD COLUMN "category" text DEFAULT 'Guides' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_docs" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "official_docs_category_sort_idx" ON "official_docs" USING btree ("category","sort_order");