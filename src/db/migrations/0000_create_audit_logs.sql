CREATE TYPE "public"."audit_action" AS ENUM('READ', 'CREATE', 'UPDATE', 'CORRECT', 'EXPORT', 'ACCESS_DENIED');--> statement-breakpoint
CREATE TYPE "public"."audit_resource_type" AS ENUM('MEDICAL_RECORD_ENTRY', 'PRESCRIPTION', 'EXAM', 'ADMISSION', 'PATIENT');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"resource_type" "audit_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"patient_id" uuid,
	"ip" "inet" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_id_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_occurred_at_idx" ON "audit_logs" USING btree ("user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_patient_id_occurred_at_idx" ON "audit_logs" USING btree ("patient_id","occurred_at" DESC NULLS FIRST);