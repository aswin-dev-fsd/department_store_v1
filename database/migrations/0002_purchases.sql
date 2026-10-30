CREATE TYPE "public"."purchase_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"purchase_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"cost_price_paise" bigint NOT NULL,
	"new_mrp_paise" bigint,
	"new_selling_price_paise" bigint,
	"batch_no" text,
	"expiry_date" date,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_lines_quantity_positive" CHECK ("purchase_lines"."quantity" > 0),
	CONSTRAINT "purchase_lines_cost_price_non_negative" CHECK ("purchase_lines"."cost_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"vendor_id" bigint NOT NULL,
	"vendor_invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"total_paise" bigint NOT NULL,
	"notes" text,
	"created_by" bigint NOT NULL,
	"posted_by" bigint,
	"posted_at" timestamp with time zone,
	"cancelled_by" bigint,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_branch_vendor_invoice_key" ON "purchases" USING btree ("branch_id","vendor_id",lower("vendor_invoice_no")) WHERE "purchases"."status" <> 'cancelled';