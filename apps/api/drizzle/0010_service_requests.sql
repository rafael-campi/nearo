CREATE TYPE "public"."service_request_status" AS ENUM('open', 'assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"address_complement" text DEFAULT '' NOT NULL,
	"neighborhood" text,
	"status" "service_request_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;