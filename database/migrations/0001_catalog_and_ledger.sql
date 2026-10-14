CREATE TYPE "public"."adjustment_reason" AS ENUM('damage', 'expiry', 'theft', 'count_correction', 'other');--> statement-breakpoint
CREATE TYPE "public"."movement_ref_type" AS ENUM('bill', 'purchase', 'adjustment', 'import');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('opening', 'purchase', 'purchase_cancel', 'sale', 'sale_cancel', 'adjustment');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_stock" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "item_stock_quantity_non_negative" CHECK ("item_stock"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"code" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"category_id" bigint,
	"mrp_paise" bigint NOT NULL,
	"selling_price_paise" bigint NOT NULL,
	"reorder_level" integer,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"gstin" text,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ref_type" "movement_ref_type" NOT NULL,
	"ref_id" bigint,
	"reason" "adjustment_reason",
	"note" text,
	"batch_no" text,
	"expiry_date" date,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_non_zero" CHECK ("stock_movements"."quantity" <> 0)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_branch_name_lower_key" ON "categories" USING btree ("branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "items_branch_code_key" ON "items" USING btree ("branch_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "items_branch_barcode_key" ON "items" USING btree ("branch_id","barcode") WHERE "items"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "items_branch_name_lower_idx" ON "items" USING btree ("branch_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stock_movements_item_created_idx" ON "stock_movements" USING btree ("item_id","created_at");