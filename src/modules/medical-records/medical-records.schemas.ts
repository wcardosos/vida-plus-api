import { z } from 'zod';
import { errorResponseSchema } from '../../shared/error-response';
import { appointmentStatusSchema, modalitySchema } from '../scheduling/scheduling.schemas';
import type { AppointmentDetails } from '../scheduling/services/scheduling.service';
import { IcdCode, MedicalRecordEntry } from './entities/medical-record-entry.entity';
import { PrescriptionItem } from './entities/prescription-item.entity';
import {
  historySections,
  type EntryDetails,
  type MedicalHistory,
  type PrescriptionDetails,
} from './services/medical-records.service';

const referenceSchema = z.object({ id: z.uuid(), name: z.string() });

function text(maxLength: number) {
  return z.string().max(maxLength).describe(`Required, up to ${maxLength} characters`);
}

const clinicalContentShape = {
  anamnesis: text(MedicalRecordEntry.anamnesisMaxLength),
  icdCode: z.string().regex(IcdCode.pattern, 'icdCode must be an ICD-10 code such as J45 or J45.0').describe('ICD-10 code such as J45 or J45.0'),
  diagnosisNotes: z
    .string()
    .max(MedicalRecordEntry.diagnosisNotesMaxLength)
    .nullable()
    .optional()
    .describe(`Free description of the diagnosis, up to ${MedicalRecordEntry.diagnosisNotesMaxLength} characters`),
  conduct: text(MedicalRecordEntry.conductMaxLength),
};

const prescriptionItemBodySchema = z.object({
  medication: text(PrescriptionItem.medicationMaxLength),
  dose: text(PrescriptionItem.doseMaxLength),
  dosageInstructions: text(PrescriptionItem.dosageInstructionsMaxLength),
  duration: text(PrescriptionItem.durationMaxLength),
});

const prescriptionBodySchema = z.object({
  validUntil: z.iso.date().describe('Last day of validity (YYYY-MM-DD), after the issue date'),
  items: z.array(prescriptionItemBodySchema).describe('At least one item, in display order'),
});

export const appointmentRecordParamsSchema = z.object({
  appointmentId: z.uuid(),
});

export const entryParamsSchema = z.object({
  entryId: z.uuid(),
});

export const patientHistoryParamsSchema = z.object({
  patientId: z.uuid(),
});

export const prescriptionParamsSchema = z.object({
  prescriptionId: z.uuid(),
});

export const createEntryBodySchema = z
  .object({
    ...clinicalContentShape,
    prescriptions: z
      .array(prescriptionBodySchema)
      .optional()
      .describe('Prescriptions issued with the entry, in the same transaction; only physicians can issue them'),
  })
  .meta({
    example: {
      anamnesis: 'Paciente relata tosse seca há 5 dias...',
      icdCode: 'J45.0',
      diagnosisNotes: 'Asma com predominância alérgica',
      conduct: 'Broncodilatador, retorno em 15 dias',
      prescriptions: [
        {
          validUntil: '2026-11-12',
          items: [{ medication: 'Salbutamol 100 mcg', dose: '2 jatos', dosageInstructions: 'de 6 em 6 horas se falta de ar', duration: '15 dias' }],
        },
      ],
    },
  });

export const correctEntryBodySchema = z
  .object({
    ...clinicalContentShape,
    correctionReason: text(MedicalRecordEntry.correctionReasonMaxLength).describe('Why the entry is being corrected; required'),
  })
  .describe('The full corrected content; the original entry is kept unchanged')
  .meta({
    example: {
      anamnesis: 'Paciente relata tosse seca há 7 dias...',
      icdCode: 'J45.0',
      diagnosisNotes: 'Asma com predominância alérgica',
      conduct: 'Broncodilatador, retorno em 15 dias',
      correctionReason: 'Duração dos sintomas registrada errada',
    },
  });

export const historyQuerySchema = z
  .object({
    from: z.iso.date().optional().describe('First local date (YYYY-MM-DD) of the period, inclusive'),
    to: z.iso.date().optional().describe('Last local date (YYYY-MM-DD) of the period, inclusive'),
    type: z.enum(historySections).optional().describe('Only fill this section; the others come empty'),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { path: ['from'], message: 'from must not be after to' });

export const medicalRecordEntryResponseSchema = z
  .object({
    id: z.uuid(),
    patientId: z.uuid(),
    professional: referenceSchema,
    appointmentId: z.uuid().nullable(),
    admissionId: z.uuid().nullable(),
    anamnesis: z.string(),
    icdCode: z.string(),
    diagnosisNotes: z.string().nullable(),
    conduct: z.string(),
    correctionOf: z.uuid().nullable().describe('Entry corrected by this one'),
    correctionReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'MedicalRecordEntry' });

export const prescriptionResponseSchema = z
  .object({
    id: z.uuid(),
    medicalRecordEntryId: z.uuid(),
    patientId: z.uuid(),
    prescriber: referenceSchema,
    issuedAt: z.iso.datetime(),
    validUntil: z.iso.date(),
    verificationCode: z.string(),
    items: z.array(
      z.object({
        position: z.number().int(),
        medication: z.string(),
        dose: z.string(),
        dosageInstructions: z.string(),
        duration: z.string(),
      }),
    ),
  })
  .meta({ id: 'Prescription' });

export const createEntryResponseSchema = medicalRecordEntryResponseSchema.extend({
  prescriptions: z.array(prescriptionResponseSchema),
});

export const correctionConflictResponseSchema = errorResponseSchema
  .extend({
    currentEntryId: z.uuid().optional().describe('Current version of the chain, the only one that accepts a correction'),
  })
  .meta({ id: 'CorrectionConflictError' });

export const medicalHistoryResponseSchema = z
  .object({
    patient: referenceSchema,
    appointments: z.array(
      z.object({
        id: z.uuid(),
        professional: referenceSchema,
        unit: referenceSchema,
        modality: modalitySchema,
        status: appointmentStatusSchema,
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
      }),
    ),
    entries: z
      .array(medicalRecordEntryResponseSchema.extend({ versionCount: z.number().int().describe('Versions in the correction chain') }))
      .describe('Only the current version of each correction chain'),
    prescriptions: z.array(prescriptionResponseSchema),
    exams: z.array(z.never()).describe('Not available yet; always empty'),
    admissions: z.array(z.never()).describe('Not available yet; always empty'),
  })
  .meta({ id: 'MedicalHistory' });

export function toEntryResponse({ entry, professional }: EntryDetails): z.infer<typeof medicalRecordEntryResponseSchema> {
  return {
    id: entry.id,
    patientId: entry.patientId,
    professional,
    appointmentId: entry.appointmentId,
    admissionId: entry.admissionId,
    anamnesis: entry.anamnesis,
    icdCode: entry.icdCode.value,
    diagnosisNotes: entry.diagnosisNotes,
    conduct: entry.conduct,
    correctionOf: entry.previousEntryId,
    correctionReason: entry.correctionReason,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toPrescriptionResponse({ prescription, prescriber }: PrescriptionDetails): z.infer<typeof prescriptionResponseSchema> {
  return {
    id: prescription.id,
    medicalRecordEntryId: prescription.medicalRecordEntryId,
    patientId: prescription.patientId,
    prescriber,
    issuedAt: prescription.issuedAt.toISOString(),
    validUntil: prescription.validUntil,
    verificationCode: prescription.verificationCode,
    items: prescription.getItems().map((item) => ({
      position: item.position,
      medication: item.medication,
      dose: item.dose,
      dosageInstructions: item.dosageInstructions,
      duration: item.duration,
    })),
  };
}

function toHistoryAppointment({ appointment, professional, unit }: AppointmentDetails) {
  return {
    id: appointment.id,
    professional,
    unit,
    modality: appointment.modality,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
  };
}

export function toHistoryResponse(history: MedicalHistory): z.infer<typeof medicalHistoryResponseSchema> {
  return {
    patient: history.patient,
    appointments: history.appointments.map(toHistoryAppointment),
    entries: history.entries.map((details) => ({ ...toEntryResponse(details), versionCount: details.versionCount })),
    prescriptions: history.prescriptions.map(toPrescriptionResponse),
    exams: [],
    admissions: [],
  };
}
