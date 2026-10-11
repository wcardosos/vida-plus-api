CREATE TYPE "public"."consent_purpose" AS ENUM('TELECONSULTATION');--> statement-breakpoint
CREATE TYPE "public"."council" AS ENUM('CRM', 'COREN');--> statement-breakpoint
CREATE TYPE "public"."professional_category" AS ENUM('PHYSICIAN', 'NURSE', 'TECHNICIAN');--> statement-breakpoint
CREATE TABLE "lgpd_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"terms_version" varchar(20) NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"cpf" char(11) NOT NULL,
	"birth_date" date NOT NULL,
	"phone" varchar(20) NOT NULL,
	"address_street" varchar(150) NOT NULL,
	"address_number" varchar(20) NOT NULL,
	"address_complement" varchar(100),
	"address_district" varchar(100) NOT NULL,
	"address_city" varchar(100) NOT NULL,
	"address_state" char(2) NOT NULL,
	"address_zip_code" char(8) NOT NULL,
	"terms_version" varchar(20) NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_units" (
	"professional_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_units_professional_id_unit_id_pk" PRIMARY KEY("professional_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"category" "professional_category" NOT NULL,
	"council" "council" NOT NULL,
	"registration_number" varchar(20) NOT NULL,
	"registration_state" char(2) NOT NULL,
	"specialty" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lgpd_consents" ADD CONSTRAINT "lgpd_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lgpd_consents_patient_id_idx" ON "lgpd_consents" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_user_id_unique_idx" ON "patients" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_cpf_unique_idx" ON "patients" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "patients_name_lower_idx" ON "patients" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "professional_units_unit_id_idx" ON "professional_units" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_user_id_unique_idx" ON "professionals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_registration_unique_idx" ON "professionals" USING btree ("council","registration_number","registration_state");