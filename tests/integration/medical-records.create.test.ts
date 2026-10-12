import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuildAppOptions } from '../../src/app';
import { pool } from '../../src/db/client';
import { loggerOptions } from '../../src/shared/logger';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, insertAppointment, tokenFor } from './helpers';
import {
  appointmentStatus,
  attendance,
  cipher,
  entryBody,
  findEntryRows,
  findPrescriptionItemRows,
  findPrescriptionRows,
  insertProfessionalWithToken,
  itemBody,
  minutesFromNow,
  prescriptionBody,
} from './medical-records-helpers';
import { clock, requester } from './scheduling-helpers';

let auditFails = false;

const failingAudit: BuildAppOptions['configureContainer'] = (container) => {
  const record = container.services.audit.record;
  container.services.audit.record = async (...args) => {
    if (auditFails) {
      throw new Error('audit storage unavailable');
    }
    return record(...args);
  };
};

const app = buildApp({ clock, configureContainer: failingAudit });
const request = requester(app);

const recordUrl = (appointmentId: string) => `/appointments/${appointmentId}/medical-records`;

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  auditFails = false;
  await clearAuditLogs();
  await clearUnits();
  await clearUsers();
});

describe('POST /appointments/:appointmentId/medical-records', () => {
  it('records an in-person appointment, completes it and stores the clinical fields encrypted', async () => {
    const { professional, patient, appointment } = await attendance(app);

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      patientId: patient.patient.id,
      professional: { id: professional.professional.id, name: 'Dra. Ana Lima' },
      appointmentId: appointment.id,
      admissionId: null,
      anamnesis: 'Paciente relata tosse seca há 5 dias',
      icdCode: 'J45.0',
      diagnosisNotes: 'Asma com predominância alérgica',
      conduct: 'Broncodilatador, retorno em 15 dias',
      correctionOf: null,
      correctionReason: null,
      prescriptions: [],
    });
    expect(await appointmentStatus(appointment)).toBe('COMPLETED');

    const [row] = await findEntryRows();
    expect(row.id).toBe(body.id);
    for (const [column, plaintext] of [
      ['anamnesis', 'Paciente relata tosse seca há 5 dias'],
      ['icdCode', 'J45.0'],
      ['diagnosisNotes', 'Asma com predominância alérgica'],
      ['conduct', 'Broncodilatador, retorno em 15 dias'],
    ] as const) {
      expect(row[column]).toMatch(/^v1:/);
      expect(row[column]).not.toContain(plaintext);
      expect(cipher.decrypt(row[column]!)).toBe(plaintext);
    }
    expect(JSON.stringify(row)).not.toContain('tosse');

    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'CREATE',
      resourceType: 'MEDICAL_RECORD_ENTRY',
      resourceId: body.id,
      patientId: patient.patient.id,
      userId: professional.user.id,
      ip: '127.0.0.1',
    });
  });

  it('keeps a teleconsultation SCHEDULED until the call ends', async () => {
    const { professional, appointment } = await attendance(app, { modality: 'TELECONSULTATION' });

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    expect(response.statusCode).toBe(201);
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
  });

  it('does not complete the appointment again on a second entry', async () => {
    const { professional, appointment } = await attendance(app);
    await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ conduct: 'Retorno antecipado' }));

    expect(response.statusCode).toBe(201);
    expect(await appointmentStatus(appointment)).toBe('COMPLETED');
    expect(await findEntryRows()).toHaveLength(2);
  });

  it('accepts an appointment that starts within 15 minutes', async () => {
    const { professional, appointment } = await attendance(app, { startsAt: minutesFromNow(15) });

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    expect(response.statusCode).toBe(201);
  });

  it("rejects another professional's appointment with 403 and records ACCESS_DENIED", async () => {
    const { unit, patient, appointment } = await attendance(app);
    const intruder = await insertProfessionalWithToken(app, unit.id);

    const response = await request('POST', recordUrl(appointment.id), intruder.token, entryBody());

    expect(response.statusCode).toBe(403);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'ACCESS_DENIED', userId: intruder.user.id, patientId: patient.patient.id });
  });

  it.each([
    ['CANCELED', { status: 'CANCELED' as const, cancellationReason: 'Paciente desmarcou', canceledBy: 'PATIENT' as const, canceledAt: minutesFromNow(-60) }],
    ['NO_SHOW', { status: 'NO_SHOW' as const }],
    ['starting in 2 hours', { startsAt: minutesFromNow(120) }],
  ])('rejects an appointment %s with 422', async (_, overrides) => {
    const { professional, appointment } = await attendance(app, overrides);

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    expect(response.statusCode).toBe(422);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it('rejects an invalid ICD code with 400', async () => {
    const { professional, appointment } = await attendance(app);

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ icdCode: 'XYZ' }));

    expect(response.statusCode).toBe(400);
    expect(response.json().details).toEqual([expect.objectContaining({ path: '/icdCode' })]);
  });

  it('rejects a blank anamnesis with 422 naming the field', async () => {
    const { professional, appointment } = await attendance(app);

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ anamnesis: '  ' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('anamnesis is required');
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
  });

  it('returns 404 for an unknown appointment', async () => {
    const { professional } = await attendance(app);

    const response = await request('POST', recordUrl('00000000-0000-4000-8000-000000000000'), professional.token, entryBody());

    expect(response.statusCode).toBe(404);
  });

  it.each(['PATIENT', 'ADMIN'] as const)('rejects the %s role with 403', async (role) => {
    const { appointment } = await attendance(app);

    const response = await request('POST', recordUrl(appointment.id), await tokenFor(app, role), entryBody());

    expect(response.statusCode).toBe(403);
    expect(await findEntryRows()).toHaveLength(0);
  });

  it('persists nothing when the audit write fails', async () => {
    const { professional, appointment } = await attendance(app);
    auditFails = true;

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ prescriptions: [prescriptionBody()] }));

    expect(response.statusCode).toBe(500);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await findPrescriptionRows()).toHaveLength(0);
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
  });
});

describe('POST /appointments/:appointmentId/medical-records with prescriptions', () => {
  it('lets a physician issue a prescription with two items, encrypted, with a unique verification code', async () => {
    const { professional, patient, appointment } = await attendance(app);
    const items = [itemBody(), itemBody({ medication: 'Prednisolona 20 mg', dose: '1 comprimido', dosageInstructions: 'pela manhã', duration: '5 dias' })];

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ prescriptions: [prescriptionBody({ items })] }));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.prescriptions).toHaveLength(1);
    const [prescription] = body.prescriptions;
    expect(prescription).toMatchObject({
      medicalRecordEntryId: body.id,
      patientId: patient.patient.id,
      prescriber: { id: professional.professional.id, name: 'Dra. Ana Lima' },
      validUntil: '2026-11-12',
      items: [
        { position: 1, ...items[0] },
        { position: 2, ...items[1] },
      ],
    });
    expect(prescription.verificationCode).toMatch(/^[A-Z2-7]{10}$/);

    const [row] = await findPrescriptionRows();
    expect(row).toMatchObject({ id: prescription.id, verificationCode: prescription.verificationCode, prescriberId: professional.professional.id });
    const itemRows = await findPrescriptionItemRows();
    expect(itemRows).toHaveLength(2);
    for (const itemRow of itemRows) {
      for (const column of ['medication', 'dose', 'dosageInstructions', 'duration'] as const) {
        expect(itemRow[column]).toMatch(/^v1:/);
      }
    }
    expect(JSON.stringify(itemRows)).not.toContain('Salbutamol');
    expect(itemRows.map((itemRow) => cipher.decrypt(itemRow.medication)).sort()).toEqual(['Prednisolona 20 mg', 'Salbutamol 100 mcg']);

    const logs = await findAuditLogs();
    expect(logs.map((log) => [log.action, log.resourceType, log.resourceId]).sort()).toEqual(
      [
        ['CREATE', 'MEDICAL_RECORD_ENTRY', body.id],
        ['CREATE', 'PRESCRIPTION', prescription.id],
      ].sort(),
    );
  });

  it('rejects prescriptions from a nurse with 403 and persists nothing', async () => {
    const { professional, appointment } = await attendance(app, {}, 'NURSE');

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ prescriptions: [prescriptionBody()] }));

    expect(response.statusCode).toBe(403);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await findPrescriptionRows()).toHaveLength(0);
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
  });

  it('lets a nurse record an entry without prescriptions', async () => {
    const { professional, appointment } = await attendance(app, {}, 'NURSE');

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody());

    expect(response.statusCode).toBe(201);
  });

  it.each([
    ['without items', prescriptionBody({ items: [] })],
    ['with a past validity', prescriptionBody({ validUntil: '2026-10-01' })],
  ])('rejects a prescription %s with 422 and persists nothing', async (_, prescription) => {
    const { professional, appointment } = await attendance(app);

    const response = await request('POST', recordUrl(appointment.id), professional.token, entryBody({ prescriptions: [prescription] }));

    expect(response.statusCode).toBe(422);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await findPrescriptionRows()).toHaveLength(0);
    expect(await appointmentStatus(appointment)).toBe('SCHEDULED');
  });
});

describe('application logs', () => {
  it('never contain the clinical content, even when the request fails', async () => {
    const lines: string[] = [];
    const { transport, ...options } = loggerOptions as typeof loggerOptions & { transport?: unknown };
    const loggedApp = buildApp({
      clock,
      configureContainer: failingAudit,
      loggerInstance: pino({ ...options, level: 'trace' }, { write: (line: string) => lines.push(line) }),
    });
    await loggedApp.ready();
    try {
      const { unit, professional, patient, appointment } = await attendance(loggedApp);
      const earlier = await insertAppointment({
        patientId: patient.patient.id,
        professionalId: professional.professional.id,
        unitId: unit.id,
        startsAt: minutesFromNow(-60),
      });
      const body = entryBody({
        anamnesis: 'Sintoma-secreto-123',
        icdCode: 'K21.9',
        prescriptions: [prescriptionBody({ items: [itemBody({ medication: 'Remedio-secreto-456' })] })],
      });
      const send = requester(loggedApp);

      const created = await send('POST', recordUrl(appointment.id), professional.token, body);
      auditFails = true;
      const failed = await send('POST', recordUrl(earlier.id), professional.token, body);

      expect(created.statusCode).toBe(201);
      expect(failed.statusCode).toBe(500);
      expect(lines.length).toBeGreaterThan(0);
      const output = lines.join('\n');
      for (const secret of ['Sintoma-secreto-123', 'K21.9', 'Remedio-secreto-456', 'Broncodilatador']) {
        expect(output).not.toContain(secret);
      }
    } finally {
      await loggedApp.close();
    }
  });
});
