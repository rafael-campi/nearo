CREATE TYPE "public"."assignment_mode" AS ENUM('manual', 'broadcast');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_needs_assignment';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_assigned';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "assignment_mode" "assignment_mode" DEFAULT 'broadcast' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "broadcast" boolean DEFAULT true NOT NULL;