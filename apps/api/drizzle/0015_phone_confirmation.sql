ALTER TYPE "public"."notification_type" ADD VALUE 'request_confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'request_declined';--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;