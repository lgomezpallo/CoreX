CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"api_key_preview" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"capabilities" jsonb DEFAULT '["chat"]'::jsonb NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"health_status" text DEFAULT 'available' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_app_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_preview" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "router_app_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "router_owner" (
	"id" text PRIMARY KEY DEFAULT 'owner' NOT NULL,
	"user_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_owner_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "router_request_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" uuid,
	"provider_name" text NOT NULL,
	"token_id" integer,
	"application_name" text NOT NULL,
	"source" text NOT NULL,
	"task_type" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"attempt_count" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error_code" integer,
	"error_type" text,
	"prompt_tokens" integer,
	"completion_tokens" integer
);
--> statement-breakpoint
CREATE TABLE "router_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_preview" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "ai_providers_user_idx" ON "ai_providers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_providers_user_default_idx" ON "ai_providers" USING btree ("user_id","is_default");--> statement-breakpoint
CREATE INDEX "router_app_tokens_user_idx" ON "router_app_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "router_request_metrics_user_created_idx" ON "router_request_metrics" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "router_request_metrics_provider_created_idx" ON "router_request_metrics" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "router_request_metrics_request_idx" ON "router_request_metrics" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "router_tokens_user_unique" ON "router_tokens" USING btree ("user_id");