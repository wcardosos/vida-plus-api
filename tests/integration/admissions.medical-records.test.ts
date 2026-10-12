import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { advancingClock, dischargeAdmission, hospital, insertAdmission, insertBed } from './admissions-helpers';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, insertPatient, insertProfessional, insertUnit, signToken, tokenFor } from './helpers';
import { entryBody, findEntryRows, prescriptionBody } from './medical-records-helpers';
import { requester } from './scheduling-helpers';

const app = buildApp({ clock: advancingClock });
const request = requester(app);

const recordUrl = (admissionId: string) => `/admissions/${admissionId}/medical-records`;

async function admitted() {
  const setup = await hospital(app);
  const admission = await insertAdmission({ patientId: setup.patient.patient.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.bed });
  return { ...setup, admission };
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

describe('GET /me/admissions', () => {
  it('lists only the active admissions the professional is responsible for, with patient and bed', async () => {
    const setup = await admitted();
    const { patient: discharged } = await insertPatient({ name: 'João' });
    const past = await insertAdmission({ patientId: discharged.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.otherBed });
    await dischargeAdmission(past, setup.otherBed);
    const colleague = await insertProfessional({ unitIds: [setup.unit.id] });
    const { patient: theirs } = await insertPatient({ name: 'Pedro' });
    await insertAdmission({ patientId: theirs.id, responsibleProfessionalId: colleague.professional.id, bed: await insertBed(setup.unit) });

    const response = await request('GET', '/me/admissions', setup.responsible.token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: setup.admission.id,
        patient: { id: setup.patient.patient.id, name: 'Maria da Silva' },
        currentBed: expect.objectContaining({ id: setup.bed.id, identification: 'ENF-01' }),
        status: 'ACTIVE',
      }),
    ]);
  });

  it('rejects ADMIN with 403', async () => {
    const response = await request('GET', '/me/admissions', await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /admissions/:admissionId/medical-records', () => {
  it('records the care of an active admission with admissionId filled and a CREATE log', async () => {
    const setup = await admitted();

    const response = await request('POST', recordUrl(setup.admission.id), setup.responsible.token, entryBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      patientId: setup.patient.patient.id,
      professional: { id: setup.responsible.professional.id, name: 'Dra. Ana Lima' },
      appointmentId: null,
      admissionId: setup.admission.id,
      anamnesis: 'Paciente relata tosse seca há 5 dias',
      icdCode: 'J45.0',
      conduct: 'Broncodilatador, retorno em 15 dias',
      prescriptions: [],
    });
    const [row] = await findEntryRows();
    expect(row).toMatchObject({ id: body.id, admissionId: setup.admission.id, appointmentId: null });
    expect(row.anamnesis).toMatch(/^v1:/);
    expect(await findAuditLogs()).toEqual([
      expect.objectContaining({ action: 'CREATE', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: body.id, patientId: setup.patient.patient.id }),
    ]);
  });

  it('issues prescriptions with the entry', async () => {
    const setup = await admitted();

    const response = await request('POST', recordUrl(setup.admission.id), setup.responsible.token, entryBody({ prescriptions: [prescriptionBody()] }));

    expect(response.statusCode).toBe(201);
    expect(response.json().prescriptions).toHaveLength(1);
  });

  it('rejects a professional who is not responsible with 403 and records ACCESS_DENIED', async () => {
    const setup = await admitted();
    const intruder = await insertProfessional({ unitIds: [setup.unit.id] });

    const response = await request('POST', recordUrl(setup.admission.id), signToken(app, intruder.user), entryBody());

    expect(response.statusCode).toBe(403);
    expect(await findEntryRows()).toHaveLength(0);
    expect(await findAuditLogs()).toEqual([
      expect.objectContaining({
        action: 'ACCESS_DENIED',
        resourceType: 'ADMISSION',
        resourceId: setup.admission.id,
        patientId: setup.patient.patient.id,
        userId: intruder.user.id,
      }),
    ]);
  });

  it('rejects a DISCHARGED admission with 422 but keeps the history of the patient readable', async () => {
    const setup = await admitted();
    await dischargeAdmission(setup.admission, setup.bed);

    const record = await request('POST', recordUrl(setup.admission.id), setup.responsible.token, entryBody());
    const history = await request('GET', `/patients/${setup.patient.patient.id}/medical-history`, setup.responsible.token);

    expect(record.statusCode).toBe(422);
    expect(record.json().message).toBe('Admission is DISCHARGED and does not accept medical records');
    expect(await findEntryRows()).toHaveLength(0);
    expect(history.statusCode).toBe(200);
    expect(history.json().admissions.map((admission: { id: string }) => admission.id)).toEqual([setup.admission.id]);
  });

  it('returns 404 for an unknown admission', async () => {
    const setup = await admitted();

    const response = await request('POST', recordUrl(randomUUID()), setup.responsible.token, entryBody());

    expect(response.statusCode).toBe(404);
  });

  it('rejects a patient with 403', async () => {
    const setup = await admitted();

    const response = await request('POST', recordUrl(setup.admission.id), setup.patient.token, entryBody());

    expect(response.statusCode).toBe(403);
  });
});

describe('medical history and admissions', () => {
  it('shows the patient their admissions in the history', async () => {
    const setup = await admitted();

    const response = await request('GET', '/me/medical-history', setup.patient.token);

    expect(response.statusCode).toBe(200);
    expect(response.json().admissions).toEqual([
      expect.objectContaining({
        id: setup.admission.id,
        unit: { id: setup.unit.id, name: 'Hospital Central' },
        responsibleProfessional: { id: setup.responsible.professional.id, name: 'Dra. Ana Lima' },
        currentBed: expect.objectContaining({ identification: 'ENF-01' }),
        status: 'ACTIVE',
        dischargedAt: null,
      }),
    ]);
  });

  it('filters the admissions section by type and by period', async () => {
    const setup = await admitted();

    const onlyAdmissions = await request('GET', '/me/medical-history?type=admission', setup.patient.token);
    const before = await request('GET', '/me/medical-history?to=2026-10-01', setup.patient.token);

    expect(onlyAdmissions.json().admissions).toHaveLength(1);
    expect(before.json().admissions).toEqual([]);
  });

  it('gives the responsible professional of an admission access to the history and entries', async () => {
    const setup = await admitted();
    const created = await request('POST', recordUrl(setup.admission.id), setup.responsible.token, entryBody());

    const history = await request('GET', `/patients/${setup.patient.patient.id}/medical-history`, setup.responsible.token);
    const versions = await request('GET', `/medical-records/${created.json().id}/versions`, setup.responsible.token);

    expect(history.statusCode).toBe(200);
    expect(history.json().entries.map((entry: { id: string }) => entry.id)).toEqual([created.json().id]);
    expect(versions.statusCode).toBe(200);
  });

  it('keeps denying a professional without appointment or admission with the patient', async () => {
    const setup = await admitted();
    const stranger = await insertProfessional({ unitIds: [setup.unit.id] });

    const response = await request('GET', `/patients/${setup.patient.patient.id}/medical-history`, signToken(app, stranger.user));

    expect(response.statusCode).toBe(403);
  });
});

describe('pendencies of active admissions', () => {
  it('blocks deactivating the responsible professional until the discharge', async () => {
    const setup = await admitted();

    const blocked = await request('POST', `/professionals/${setup.responsible.professional.id}/deactivate`, setup.adminToken);
    await request('POST', `/admissions/${setup.admission.id}/discharge`, setup.adminToken);
    const allowed = await request('POST', `/professionals/${setup.responsible.professional.id}/deactivate`, setup.adminToken);

    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().pendencies).toEqual([{ type: 'ACTIVE_ADMISSIONS', count: 1 }]);
    expect(allowed.statusCode).toBe(204);
  });

  it('blocks unlinking the responsible professional from the unit of an active admission', async () => {
    const setup = await admitted();
    const other = await insertUnit({ type: 'HOSPITAL' });
    await request('POST', `/professionals/${setup.responsible.professional.id}/units`, setup.adminToken, { unitId: other.id });

    const response = await request('DELETE', `/professionals/${setup.responsible.professional.id}/units/${setup.unit.id}`, setup.adminToken);

    expect(response.statusCode).toBe(422);
    expect(response.json().pendencies).toEqual([{ type: 'ACTIVE_ADMISSIONS', count: 1 }]);
  });

  it('blocks deactivating a unit with active admissions', async () => {
    const setup = await admitted();

    const response = await request('POST', `/units/${setup.unit.id}/deactivate`, setup.adminToken);

    expect(response.statusCode).toBe(422);
    expect(response.json().pendencies).toEqual([{ type: 'ACTIVE_ADMISSIONS', count: 1 }]);
  });
});
