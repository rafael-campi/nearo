CREATE TYPE "public"."photo_purpose" AS ENUM('request_photo', 'chat_photo');--> statement-breakpoint
CREATE TABLE "service_request_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"service_request_id" uuid NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "photo_purpose" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "service_request_photos" ADD CONSTRAINT "service_request_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_photos" ADD CONSTRAINT "service_request_photos_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;