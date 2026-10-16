ALTER TYPE "public"."notification_type" ADD VALUE 'request_unclaimed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_expired';--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "opened_at" timestamp with time zone;