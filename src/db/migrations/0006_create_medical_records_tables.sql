ALTER TYPE "public"."audit_resource_type" ADD VALUE 'PATIENT_HISTORY';--> statement-breakpoint
CREATE TABLE "medical_record_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"appointment_id" uuid,
	"admission_id" uuid,
	"previous_entry_id" uuid,
	"anamnesis" text NOT NULL,
	"icd_code" text NOT NULL,
	"diagnosis_notes" text,
	"conduct" text NOT NULL,
	"correction_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "medical_record_entries_single_origin_check" CHECK (num_nonnulls("medical_record_entries"."appointment_id", "medical_record_entries"."admission_id") = 1),
	CONSTRAINT "medical_record_entries_correction_reason_check" CHECK (("medical_record_entries"."previous_entry_id" IS NULL) = ("medical_record_entries"."correction_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prescription_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"medication" text NOT NULL,
	"dose" text NOT NULL,
	"dosage_instructions" text NOT NULL,
	"duration" text NOT NULL,
	CONSTRAINT "prescription_items_position_check" CHECK ("prescription_items"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"medical_record_entry_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"prescriber_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"valid_until" date NOT NULL,
	"verification_code" varchar(10) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medical_record_entries" ADD CONSTRAINT "medical_record_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_record_entries" ADD CONSTRAINT "medical_record_entries_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_record_entries" ADD CONSTRAINT "medical_record_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_record_entries" ADD CONSTRAINT "medical_record_entries_previous_entry_id_fk" FOREIGN KEY ("previous_entry_id") REFERENCES "public"."medical_record_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medical_record_entry_id_medical_record_entries_id_fk" FOREIGN KEY ("medical_record_entry_id") REFERENCES "public"."medical_record_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescriber_id_professionals_id_fk" FOREIGN KEY ("prescriber_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medical_record_entries_previous_entry_id_unique_idx" ON "medical_record_entries" USING btree ("previous_entry_id");--> statement-breakpoint
CREATE INDEX "medical_record_entries_patient_created_at_idx" ON "medical_record_entries" USING btree ("patient_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "medical_record_entries_appointment_id_idx" ON "medical_record_entries" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_items_prescription_position_unique_idx" ON "prescription_items" USING btree ("prescription_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_verification_code_unique_idx" ON "prescriptions" USING btree ("verification_code");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_issued_at_idx" ON "prescriptions" USING btree ("patient_id","issued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "prescriptions_medical_record_entry_id_idx" ON "prescriptions" USING btree ("medical_record_entry_id");--> statement-breakpoint
CREATE INDEX "appointments_professional_patient_idx" ON "appointments" USING btree ("professional_id","patient_id");