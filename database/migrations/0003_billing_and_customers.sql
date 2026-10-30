CREATE TYPE "public"."bill_status" AS ENUM('completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'upi', 'card');--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bill_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bill_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" bigint NOT NULL,
	"item_name" text NOT NULL,
	"item_code" text NOT NULL,
	"mrp_paise" bigint NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"discount_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"taxable_paise" bigint,
	"cgst_paise" bigint,
	"sgst_paise" bigint,
	"igst_paise" bigint,
	CONSTRAINT "bill_lines_quantity_positive" CHECK ("bill_lines"."quantity" > 0),
	CONSTRAINT "bill_lines_discount_non_negative" CHECK ("bill_lines"."discount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bill_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bill_id" bigint NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "bill_payments_amount_positive" CHECK ("bill_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "bill_sequences" (
	"branch_id" bigint NOT NULL,
	"fy" text NOT NULL,
	"last_seq" integer NOT NULL,
	CONSTRAINT "bill_sequences_branch_id_fy_pk" PRIMARY KEY("branch_id","fy")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"bill_no" text NOT NULL,
	"bill_date" date NOT NULL,
	"cashier_id" bigint NOT NULL,
	"customer_id" bigint,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint NOT NULL,
	"round_off_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"taxable_paise" bigint,
	"tax_paise" bigint,
	"status" "bill_status" DEFAULT 'completed' NOT NULL,
	"cancelled_by" bigint,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_bill_no_key" UNIQUE("bill_no"),
	CONSTRAINT "bills_branch_fy_seq_key" UNIQUE("branch_id","fy","seq")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"phone" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_key" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sequences" ADD CONSTRAINT "bill_sequences_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_branch_date_idx" ON "bills" USING btree ("branch_id","bill_date");--> statement-breakpoint
CREATE INDEX "bills_cashier_date_idx" ON "bills" USING btree ("cashier_id","bill_date");--> statement-breakpoint
CREATE INDEX "bills_customer_id_idx" ON "bills" USING btree ("customer_id");