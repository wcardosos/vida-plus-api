CREATE TYPE "public"."admission_status" AS ENUM('ACTIVE', 'DISCHARGED');--> statement-breakpoint
CREATE TYPE "public"."bed_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."bed_type" AS ENUM('ICU', 'WARD');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('ADMISSION', 'TRANSFER', 'DISCHARGE');--> statement-breakpoint
CREATE TABLE "admission_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"from_bed_id" uuid,
	"to_bed_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admission_movements_beds_check" CHECK (CASE "admission_movements"."type"
        WHEN 'ADMISSION' THEN "admission_movements"."from_bed_id" IS NULL AND "admission_movements"."to_bed_id" IS NOT NULL
        WHEN 'DISCHARGE' THEN "admission_movements"."from_bed_id" IS NOT NULL AND "admission_movements"."to_bed_id" IS NULL
        ELSE "admission_movements"."from_bed_id" IS NOT NULL AND "admission_movements"."to_bed_id" IS NOT NULL AND "admission_movements"."from_bed_id" <> "admission_movements"."to_bed_id"
      END)
);
--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"current_bed_id" uuid NOT NULL,
	"responsible_professional_id" uuid NOT NULL,
	"status" "admission_status" NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"discharged_at" timestamp with time zone,
	CONSTRAINT "admissions_discharged_at_check" CHECK (("admissions"."status" = 'DISCHARGED') = ("admissions"."discharged_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "beds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"identification" varchar(20) NOT NULL,
	"sector" varchar(60) NOT NULL,
	"type" "bed_type" NOT NULL,
	"status" "bed_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_movements" ADD CONSTRAINT "admission_movements_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_movements" ADD CONSTRAINT "admission_movements_from_bed_id_beds_id_fk" FOREIGN KEY ("from_bed_id") REFERENCES "public"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_movements" ADD CONSTRAINT "admission_movements_to_bed_id_beds_id_fk" FOREIGN KEY ("to_bed_id") REFERENCES "public"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_current_bed_id_beds_id_fk" FOREIGN KEY ("current_bed_id") REFERENCES "public"."beds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_responsible_professional_id_professionals_id_fk" FOREIGN KEY ("responsible_professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_movements_admission_occurred_at_idx" ON "admission_movements" USING btree ("admission_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_active_bed_unique_idx" ON "admissions" USING btree ("current_bed_id") WHERE "admissions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_active_patient_unique_idx" ON "admissions" USING btree ("patient_id") WHERE "admissions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "admissions_responsible_status_idx" ON "admissions" USING btree ("responsible_professional_id","status");--> statement-breakpoint
CREATE INDEX "admissions_patient_admitted_at_idx" ON "admissions" USING btree ("patient_id","admitted_at");--> statement-breakpoint
CREATE INDEX "admissions_unit_status_idx" ON "admissions" USING btree ("unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "beds_unit_identification_unique_idx" ON "beds" USING btree ("unit_id","identification");--> statement-breakpoint
CREATE INDEX "beds_unit_status_idx" ON "beds" USING btree ("unit_id","status");