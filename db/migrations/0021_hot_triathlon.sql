CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(24, 12) NOT NULL,
	"provider" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_base_quote_date_unique" ON "fx_rates" USING btree ("base","quote","rate_date");--> statement-breakpoint
CREATE INDEX "fx_rates_base_date_idx" ON "fx_rates" USING btree ("base","rate_date");