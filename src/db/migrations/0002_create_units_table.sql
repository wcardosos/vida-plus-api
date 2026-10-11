CREATE TYPE "public"."unit_type" AS ENUM('HOSPITAL', 'CLINIC', 'LABORATORY', 'HOME_CARE');--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "unit_type" NOT NULL,
	"cnpj" char(14) NOT NULL,
	"address_street" varchar(150) NOT NULL,
	"address_number" varchar(20) NOT NULL,
	"address_complement" varchar(100),
	"address_district" varchar(100) NOT NULL,
	"address_city" varchar(100) NOT NULL,
	"address_state" char(2) NOT NULL,
	"address_zip_code" char(8) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "units_cnpj_unique_idx" ON "units" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "units_type_active_idx" ON "units" USING btree ("type","active");