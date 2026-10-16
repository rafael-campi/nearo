ALTER TYPE "public"."notification_type" ADD VALUE 'provider_nearby';--> statement-breakpoint
CREATE TABLE "provider_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"service_request_id" uuid NOT NULL,
	"location" geometry(point) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "proximity_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_positions" ADD CONSTRAINT "provider_positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_positions" ADD CONSTRAINT "provider_positions_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;