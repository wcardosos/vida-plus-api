CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('SCHEDULED', 'CANCELED', 'COMPLETED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."cancellation_actor" AS ENUM('PATIENT', 'PROFESSIONAL');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('IN_PERSON', 'TELECONSULTATION');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"modality" "modality" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" NOT NULL,
	"cancellation_reason" varchar(200),
	"canceled_by" "cancellation_actor",
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_range_check" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_cancellation_reason_check" CHECK (("appointments"."status" = 'CANCELED') = ("appointments"."cancellation_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "schedule_availabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"professional_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"slot_minutes" smallint NOT NULL,
	"modality" "modality" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_availabilities_weekday_check" CHECK ("schedule_availabilities"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "schedule_availabilities_time_range_check" CHECK ("schedule_availabilities"."end_time" > "schedule_availabilities"."start_time"),
	CONSTRAINT "schedule_availabilities_slot_minutes_check" CHECK ("schedule_availabilities"."slot_minutes" BETWEEN 5 AND 240)
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_time_range_check" CHECK ("schedule_blocks"."ends_at" > "schedule_blocks"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_availabilities" ADD CONSTRAINT "schedule_availabilities_professional_unit_fk" FOREIGN KEY ("professional_id","unit_id") REFERENCES "public"."professional_units"("professional_id","unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_professional_starts_at_idx" ON "appointments" USING btree ("professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_starts_at_idx" ON "appointments" USING btree ("patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_unit_starts_at_idx" ON "appointments" USING btree ("unit_id","starts_at");--> statement-breakpoint
CREATE INDEX "schedule_availabilities_professional_weekday_idx" ON "schedule_availabilities" USING btree ("professional_id","weekday");--> statement-breakpoint
CREATE INDEX "schedule_blocks_professional_starts_at_idx" ON "schedule_blocks" USING btree ("professional_id","starts_at");