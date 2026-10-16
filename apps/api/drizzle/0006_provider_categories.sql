CREATE TABLE "provider_categories" (
	"company_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "provider_categories_membership_id_category_id_pk" PRIMARY KEY("membership_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;