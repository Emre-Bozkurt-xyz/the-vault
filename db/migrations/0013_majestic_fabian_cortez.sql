CREATE TABLE "user_extension_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_extension_settings" ADD CONSTRAINT "user_extension_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_extension_settings_user_extension_unique" ON "user_extension_settings" USING btree ("user_id","extension_id");--> statement-breakpoint
CREATE INDEX "user_extension_settings_user_id_idx" ON "user_extension_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_extension_settings_extension_id_idx" ON "user_extension_settings" USING btree ("extension_id");--> statement-breakpoint
CREATE INDEX "user_extension_settings_enabled_idx" ON "user_extension_settings" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_namespace_key_unique" ON "user_settings" USING btree ("user_id","namespace","key");--> statement-breakpoint
CREATE INDEX "user_settings_user_id_idx" ON "user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_settings_namespace_idx" ON "user_settings" USING btree ("namespace");