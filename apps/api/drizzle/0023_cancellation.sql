CREATE TYPE "public"."event_actor" AS ENUM('client', 'admin', 'provider', 'system');--> statement-breakpoint
CREATE TYPE "public"."request_event_kind" AS ENUM('cancellation', 'withdrawal');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_cancelled';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_withdrawn';--> statement-breakpoint
CREATE TABLE "service_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"service_request_id" uuid NOT NULL,
	"kind" "request_event_kind" NOT NULL,
	"by_role" "event_actor" NOT NULL,
	"by_user_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "cancelled_by_role" "event_actor";--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;