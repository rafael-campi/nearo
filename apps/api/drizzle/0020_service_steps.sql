ALTER TYPE "public"."notification_type" ADD VALUE 'request_status';--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "en_route_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "completed_at" timestamp with time zone;