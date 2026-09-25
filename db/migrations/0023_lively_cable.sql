CREATE TABLE "code_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"language_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"image_digest" text,
	"runtime_version" text,
	"source" text NOT NULL,
	"stdin" text DEFAULT '' NOT NULL,
	"source_hash" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"request_id" text NOT NULL,
	"worker_id" text,
	"attempt_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"compiler_output" text,
	"stdout" text,
	"stderr" text,
	"exit_code" integer,
	"signal" text,
	"output_truncated" boolean DEFAULT false NOT NULL,
	"queue_ms" integer,
	"prepare_ms" integer,
	"compile_ms" integer,
	"run_ms" integer,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_jobs" ADD CONSTRAINT "code_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_jobs" ADD CONSTRAINT "code_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_jobs_user_request_unique" ON "code_jobs" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "code_jobs_claimable_idx" ON "code_jobs" USING btree ("state","queued_at");--> statement-breakpoint
CREATE INDEX "code_jobs_user_queued_idx" ON "code_jobs" USING btree ("user_id","queued_at");--> statement-breakpoint
CREATE INDEX "code_jobs_lease_idx" ON "code_jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "code_jobs_expires_idx" ON "code_jobs" USING btree ("expires_at");