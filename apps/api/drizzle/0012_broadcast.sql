CREATE TYPE "public"."decline_by" AS ENUM('provider', 'client');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_request', 'request_accepted');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"service_request_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_declines" (
	"company_id" uuid NOT NULL,
	"service_request_id" uuid NOT NULL,
	"provider_membership_id" uuid NOT NULL,
	"by" "decline_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_declines_service_request_id_provider_membership_id_pk" PRIMARY KEY("service_request_id","provider_membership_id")
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "provider_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_declines" ADD CONSTRAINT "service_request_declines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_declines" ADD CONSTRAINT "service_request_declines_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_declines" ADD CONSTRAINT "service_request_declines_provider_membership_id_memberships_id_fk" FOREIGN KEY ("provider_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_provider_membership_id_memberships_id_fk" FOREIGN KEY ("provider_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;