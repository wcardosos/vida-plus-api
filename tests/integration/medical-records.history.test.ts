import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, insertAppointment, insertUnit, tokenFor } from './helpers';
import {
  insertCorrection,
  insertEntry,
  insertPatientWithToken,
  insertPrescription,
  insertProfessionalWithToken,
  minutesFromNow,
} from './medical-records-helpers';
import { clock, requester } from './scheduling-helpers';

const app = buildApp({ clock });
const request = requester(app);

const at = (date: string) => new Date(`${date}T15:00:00.000Z`);

async function network() {
  const centro = await insertUnit({ name: 'Unidade Centro' });
  const norte = await insertUnit({ name: 'Unidade Norte' });
  const ana = await insertProfessionalWithToken(app, centro.id, 'PHYSICIAN', 'Dra. Ana');
  const bruno = await insertProfessionalWithToken(app, norte.id, 'PHYSICIAN', 'Dr. Bruno');
  const maria = await insertPatientWithToken(app, 'Maria');
  const other = await insertPatientWithToken(app, 'João');

  const atCentro = await insertAppointment({
    patientId: maria.patient.id,
    professionalId: ana.professional.id,
    unitId: centro.id,
    startsAt: at('2026-10-05'),
    status: 'COMPLETED',
  });
  const atNorte = await insertAppointment({
    patientId: maria.patient.id,
    professionalId: bruno.professional.id,
    unitId: norte.id,
    startsAt: at('2026-10-09'),
    status: 'COMPLETED',
  });

  const original = await insertEntry(
    { patientId: maria.patient.id, professionalId: ana.professional.id, appointmentId: atCentro.id, anamnesis: 'Tosse seca' },
    at('2026-10-05'),
  );
  const corrected = await insertCorrection(original, at('2026-10-06'), { anamnesis: 'Tosse seca há 7 dias' });
  const norteEntry = await insertEntry(
    { patientId: maria.patient.id, professionalId: bruno.professional.id, appointmentId: atNorte.id, anamnesis: 'Dor lombar', icdCode: 'M54.5' },
    at('2026-10-09'),
  );
  const centroPrescription = await insertPrescription(original, ana.professional, at('2026-10-05'));
  const nortePrescription = await insertPrescription(norteEntry, bruno.professional, at('2026-10-09'));

  const otherAppointment = await insertAppointment({
    patientId: other.patient.id,
    professionalId: ana.professional.id,
    unitId: centro.id,
    startsAt: at('2026-10-07'),
    status: 'COMPLETED',
  });
  await insertEntry({ patientId: other.patient.id, professionalId: ana.professional.id, appointmentId: otherAppointment.id }, at('2026-10-07'));

  return { centro, norte, ana, bruno, maria, other, atCentro, atNorte, original, corrected, norteEntry, centroPrescription, nortePrescription };
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await clearAuditLogs();
  await clearUnits();
  await clearUsers();
});

describe('GET /me/medical-history', () => {
  it('shows appointments, current entries and prescriptions from every unit and records one READ', async () => {
    const { centro, norte, maria, atCentro, atNorte, original, corrected, norteEntry, centroPrescription, nortePrescription } = await network();

    const response = await request('GET', '/me/medical-history', maria.token);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.patient).toEqual({ id: maria.patient.id, name: 'Maria' });
    expect(body.appointments.map((appointment: { id: string; unit: { name: string } }) => [appointment.id, appointment.unit.name])).toEqual([
      [atNorte.id, norte.name],
      [atCentro.id, centro.name],
    ]);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ id: norteEntry.id, anamnesis: 'Dor lombar', icdCode: 'M54.5', correctionOf: null, versionCount: 1 });
    expect(body.entries[1]).toMatchObject({
      id: corrected.id,
      anamnesis: 'Tosse seca há 7 dias',
      correctionOf: original.id,
      correctionReason: 'Duração dos sintomas registrada errada',
      versionCount: 2,
      professional: { name: 'Dra. Ana' },
    });
    expect(body.prescriptions.map((prescription: { id: string }) => prescription.id)).toEqual([nortePrescription.id, centroPrescription.id]);
    expect(body.prescriptions[0]).toMatchObject({ prescriber: { name: 'Dr. Bruno' }, items: [{ position: 1, medication: 'Salbutamol 100 mcg' }] });
    expect(body.exams).toEqual([]);
    expect(body.admissions).toEqual([]);

    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'READ',
      resourceType: 'PATIENT_HISTORY',
      resourceId: maria.patient.id,
      patientId: maria.patient.id,
      userId: maria.user.id,
      ip: '127.0.0.1',
    });
  });

  it('filters by period and type', async () => {
    const { maria, nortePrescription } = await network();

    const response = await request('GET', '/me/medical-history?from=2026-10-08&to=2026-10-10&type=prescription', maria.token);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.prescriptions.map((prescription: { id: string }) => prescription.id)).toEqual([nortePrescription.id]);
    expect(body.appointments).toEqual([]);
    expect(body.entries).toEqual([]);
  });

  it('filters every section by period, including both bounds', async () => {
    const { maria, atCentro, corrected, centroPrescription } = await network();

    const response = await request('GET', '/me/medical-history?from=2026-10-05&to=2026-10-06', maria.token);

    const body = response.json();
    expect(body.appointments.map((appointment: { id: string }) => appointment.id)).toEqual([atCentro.id]);
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual([corrected.id]);
    expect(body.prescriptions.map((prescription: { id: string }) => prescription.id)).toEqual([centroPrescription.id]);
  });

  it.each(['from=2026-10-10&to=2026-10-01', 'type=exam', 'from=10/01/2026'])('rejects the query %s with 400', async (query) => {
    const { maria } = await network();

    const response = await request('GET', `/me/medical-history?${query}`, maria.token);

    expect(response.statusCode).toBe(400);
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it('returns empty sections for a patient without history', async () => {
    const { token } = await insertPatientWithToken(app);

    const response = await request('GET', '/me/medical-history', token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ appointments: [], entries: [], prescriptions: [], exams: [], admissions: [] });
  });

  it.each(['PROFESSIONAL', 'ADMIN'] as const)('rejects the %s role with 403', async (role) => {
    const response = await request('GET', '/me/medical-history', await tokenFor(app, role));

    expect(response.statusCode).toBe(403);
  });

  it('answers 200 entries in under 2 seconds', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessionalWithToken(app, unit.id);
    const maria = await insertPatientWithToken(app);
    for (let index = 0; index < 200; index += 1) {
      const appointment = await insertAppointment({
        patientId: maria.patient.id,
        professionalId: professional.id,
        unitId: unit.id,
        startsAt: minutesFromNow(-60 * (index + 1)),
        status: 'COMPLETED',
      });
      await insertEntry({ patientId: maria.patient.id, professionalId: professional.id, appointmentId: appointment.id }, minutesFromNow(-60 * index));
    }

    const startedAt = performance.now();
    const response = await request('GET', '/me/medical-history', maria.token);
    const elapsed = performance.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(200);
    expect(response.json().appointments).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('GET /patients/:patientId/medical-history', () => {
  it('shows a linked professional the entries of other professionals and units and records one READ', async () => {
    const { ana, maria, norteEntry, corrected } = await network();

    const response = await request('GET', `/patients/${maria.patient.id}/medical-history`, ana.token);

    expect(response.statusCode).toBe(200);
    expect(response.json().entries.map((entry: { id: string }) => entry.id)).toEqual([norteEntry.id, corrected.id]);
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'READ', resourceType: 'PATIENT_HISTORY', resourceId: maria.patient.id, userId: ana.user.id });
  });

  it('grants access through a future scheduled appointment', async () => {
    const { centro, maria } = await network();
    const davi = await insertProfessionalWithToken(app, centro.id, 'NURSE', 'Enf. Davi');
    await insertAppointment({ patientId: maria.patient.id, professionalId: davi.professional.id, unitId: centro.id, startsAt: minutesFromNow(60 * 24) });

    const response = await request('GET', `/patients/${maria.patient.id}/medical-history`, davi.token);

    expect(response.statusCode).toBe(200);
  });

  it('rejects a professional with only canceled appointments with 403 and records ACCESS_DENIED', async () => {
    const { centro, maria } = await network();
    const carla = await insertProfessionalWithToken(app, centro.id, 'PHYSICIAN', 'Dra. Carla');
    await insertAppointment({
      patientId: maria.patient.id,
      professionalId: carla.professional.id,
      unitId: centro.id,
      startsAt: minutesFromNow(60 * 24),
      status: 'CANCELED',
      cancellationReason: 'Agenda cheia',
      canceledBy: 'PROFESSIONAL',
      canceledAt: minutesFromNow(-60),
    });

    const response = await request('GET', `/patients/${maria.patient.id}/medical-history`, carla.token);

    expect(response.statusCode).toBe(403);
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'ACCESS_DENIED',
      resourceType: 'PATIENT_HISTORY',
      resourceId: maria.patient.id,
      patientId: maria.patient.id,
      userId: carla.user.id,
    });
  });

  it('rejects ADMIN with 403', async () => {
    const { maria } = await network();

    const response = await request('GET', `/patients/${maria.patient.id}/medical-history`, await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(403);
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it('returns 404 for an unknown patient', async () => {
    const { ana } = await network();

    const response = await request('GET', '/patients/00000000-0000-4000-8000-000000000000/medical-history', ana.token);

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /prescriptions/:prescriptionId', () => {
  it('lets the patient read their prescription and records one READ', async () => {
    const { maria, nortePrescription } = await network();

    const response = await request('GET', `/prescriptions/${nortePrescription.id}`, maria.token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: nortePrescription.id,
      verificationCode: nortePrescription.verificationCode,
      validUntil: '2026-12-31',
      prescriber: { name: 'Dr. Bruno' },
      items: [{ position: 1, medication: 'Salbutamol 100 mcg', dose: '2 jatos' }],
    });
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'READ', resourceType: 'PRESCRIPTION', resourceId: nortePrescription.id, patientId: maria.patient.id });
  });

  it("lets a linked professional read another professional's prescription", async () => {
    const { ana, nortePrescription } = await network();

    const response = await request('GET', `/prescriptions/${nortePrescription.id}`, ana.token);

    expect(response.statusCode).toBe(200);
  });

  it('rejects another patient with 403 and records ACCESS_DENIED', async () => {
    const { other, nortePrescription } = await network();

    const response = await request('GET', `/prescriptions/${nortePrescription.id}`, other.token);

    expect(response.statusCode).toBe(403);
    expect((await findAuditLogs())[0]).toMatchObject({ action: 'ACCESS_DENIED', resourceType: 'PRESCRIPTION', resourceId: nortePrescription.id });
  });

  it('rejects a professional without a link with 403', async () => {
    const { norte, nortePrescription } = await network();
    const stranger = await insertProfessionalWithToken(app, norte.id);

    const response = await request('GET', `/prescriptions/${nortePrescription.id}`, stranger.token);

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for an unknown prescription', async () => {
    const { maria } = await network();

    const response = await request('GET', '/prescriptions/00000000-0000-4000-8000-000000000000', maria.token);

    expect(response.statusCode).toBe(404);
  });
});
