import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, tokenFor } from './helpers';
import {
  attendance,
  correctionBody,
  findEntryRow,
  findEntryRows,
  insertCorrection,
  insertEntry,
  insertPatientWithToken,
  insertProfessionalWithToken,
  minutesFromNow,
} from './medical-records-helpers';
import { clock, requester } from './scheduling-helpers';

const app = buildApp({ clock });
const request = requester(app);

const correctionUrl = (entryId: string) => `/medical-records/${entryId}/corrections`;
const versionsUrl = (entryId: string) => `/medical-records/${entryId}/versions`;

async function recorded() {
  const scenario = await attendance(app);
  const entry = await insertEntry(
    { patientId: scenario.patient.patient.id, professionalId: scenario.professional.professional.id, appointmentId: scenario.appointment.id },
    minutesFromNow(-2),
  );
  return { ...scenario, entry };
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

describe('POST /medical-records/:entryId/corrections', () => {
  it('creates a new entry pointing to the original and keeps the original byte for byte', async () => {
    const { professional, patient, appointment, entry } = await recorded();
    const before = await findEntryRow(entry.id);

    const response = await request('POST', correctionUrl(entry.id), professional.token, correctionBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      patientId: patient.patient.id,
      professional: { id: professional.professional.id },
      appointmentId: appointment.id,
      admissionId: null,
      anamnesis: 'Paciente relata tosse seca há 7 dias',
      icdCode: 'J45.1',
      diagnosisNotes: null,
      correctionOf: entry.id,
      correctionReason: 'Duração dos sintomas registrada errada',
    });
    expect(body.id).not.toBe(entry.id);
    expect(await findEntryRow(entry.id)).toEqual(before);
    expect(await findEntryRows()).toHaveLength(2);

    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'CORRECT',
      resourceType: 'MEDICAL_RECORD_ENTRY',
      resourceId: body.id,
      patientId: patient.patient.id,
      userId: professional.user.id,
      ip: '127.0.0.1',
    });
  });

  it("rejects another professional's entry with 403 and records ACCESS_DENIED", async () => {
    const { unit, patient, entry } = await recorded();
    const other = await insertProfessionalWithToken(app, unit.id);

    const response = await request('POST', correctionUrl(entry.id), other.token, correctionBody());

    expect(response.statusCode).toBe(403);
    expect(await findEntryRows()).toHaveLength(1);
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'ACCESS_DENIED', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: entry.id, patientId: patient.patient.id });
  });

  it('rejects correcting an already corrected entry with 409 pointing to the current version', async () => {
    const { professional, entry } = await recorded();
    const current = await insertCorrection(entry, minutesFromNow(-1));

    const response = await request('POST', correctionUrl(entry.id), professional.token, correctionBody());

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ statusCode: 409, currentEntryId: current.id });
    expect(await findEntryRows()).toHaveLength(2);
  });

  it('points to the newest version of a longer chain', async () => {
    const { professional, entry } = await recorded();
    const first = await insertCorrection(entry, minutesFromNow(-1));
    const second = await insertCorrection(first, minutesFromNow(0), { correctionReason: 'Conduta incompleta' });

    const response = await request('POST', correctionUrl(entry.id), professional.token, correctionBody());

    expect(response.statusCode).toBe(409);
    expect(response.json().currentEntryId).toBe(second.id);
  });

  it('accepts only one of two concurrent corrections of the same entry', async () => {
    const { professional, entry } = await recorded();

    const responses = await Promise.all([
      request('POST', correctionUrl(entry.id), professional.token, correctionBody()),
      request('POST', correctionUrl(entry.id), professional.token, correctionBody({ conduct: 'Outra conduta' })),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await findEntryRows()).toHaveLength(2);
  });

  it('rejects a blank correction reason with 422', async () => {
    const { professional, entry } = await recorded();

    const response = await request('POST', correctionUrl(entry.id), professional.token, correctionBody({ correctionReason: '   ' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('correctionReason is required');
    expect(await findEntryRows()).toHaveLength(1);
  });

  it('rejects a body without the correction reason with 400', async () => {
    const { professional, entry } = await recorded();
    const { correctionReason, ...body } = correctionBody();

    const response = await request('POST', correctionUrl(entry.id), professional.token, body);

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an unknown entry', async () => {
    const { professional } = await recorded();

    const response = await request('POST', correctionUrl('00000000-0000-4000-8000-000000000000'), professional.token, correctionBody());

    expect(response.statusCode).toBe(404);
  });

  it('rejects a patient with 403', async () => {
    const { patient, entry } = await recorded();

    const response = await request('POST', correctionUrl(entry.id), patient.token, correctionBody());

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /medical-records/:entryId/versions', () => {
  async function chain() {
    const scenario = await recorded();
    const first = await insertCorrection(scenario.entry, minutesFromNow(-1), { correctionReason: 'Duração errada' });
    const second = await insertCorrection(first, minutesFromNow(0), { correctionReason: 'Conduta incompleta' });
    return { ...scenario, first, second };
  }

  it('returns the 3 versions newest first with the reasons and records one READ', async () => {
    const { professional, patient, entry, first, second } = await chain();

    const response = await request('GET', versionsUrl(second.id), professional.token);

    expect(response.statusCode).toBe(200);
    expect(response.json().map((version: { id: string; correctionOf: string | null; correctionReason: string | null }) => [
      version.id,
      version.correctionOf,
      version.correctionReason,
    ])).toEqual([
      [second.id, first.id, 'Conduta incompleta'],
      [first.id, entry.id, 'Duração errada'],
      [entry.id, null, null],
    ]);
    expect(response.json()[2].anamnesis).toBe('Paciente relata tosse seca há 5 dias');

    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'READ',
      resourceType: 'MEDICAL_RECORD_ENTRY',
      resourceId: second.id,
      patientId: patient.patient.id,
      userId: professional.user.id,
    });
  });

  it('returns the whole chain from any version', async () => {
    const { professional, entry, second } = await chain();

    const response = await request('GET', versionsUrl(entry.id), professional.token);

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].id).toBe(second.id);
    expect(response.json()).toHaveLength(3);
  });

  it('lets the patient see the versions of their own entry', async () => {
    const { patient, second } = await chain();

    const response = await request('GET', versionsUrl(second.id), patient.token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(3);
  });

  it("rejects another patient with 403 and records ACCESS_DENIED", async () => {
    const { second } = await chain();
    const other = await insertPatientWithToken(app, 'João');

    const response = await request('GET', versionsUrl(second.id), other.token);

    expect(response.statusCode).toBe(403);
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'ACCESS_DENIED', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: second.id, userId: other.user.id });
  });

  it('rejects a professional without a link to the patient with 403', async () => {
    const { unit, second } = await chain();
    const stranger = await insertProfessionalWithToken(app, unit.id);

    const response = await request('GET', versionsUrl(second.id), stranger.token);

    expect(response.statusCode).toBe(403);
    expect((await findAuditLogs())[0]).toMatchObject({ action: 'ACCESS_DENIED' });
  });

  it('rejects ADMIN with 403', async () => {
    const { second } = await chain();

    const response = await request('GET', versionsUrl(second.id), await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for an unknown entry', async () => {
    const { professional } = await chain();

    const response = await request('GET', versionsUrl('00000000-0000-4000-8000-000000000000'), professional.token);

    expect(response.statusCode).toBe(404);
  });
});
