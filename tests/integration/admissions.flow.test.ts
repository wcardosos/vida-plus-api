import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuildAppOptions } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import {
  advancingClock,
  bedStatus,
  dischargeAdmission,
  findAdmissionRows,
  findMovementRows,
  hospital,
  insertAdmission,
  insertBed,
} from './admissions-helpers';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, insertPatient, insertProfessional, insertUnit, signToken, tokenFor } from './helpers';
import { requester } from './scheduling-helpers';

let auditFails = false;

type PausePoint = 'bed-locked' | 'admission-inserted';

type Gate = { at: PausePoint; held: () => void; release: Promise<void> };

let admissionGate: Gate | null = null;

async function pauseAt(point: PausePoint): Promise<void> {
  const gate = admissionGate;
  if (gate?.at === point) {
    admissionGate = null;
    gate.held();
    await gate.release;
  }
}

const configureContainer: BuildAppOptions['configureContainer'] = (container) => {
  const record = container.services.audit.record;
  container.services.audit.record = async (...args) => {
    if (auditFails) {
      throw new Error('audit storage unavailable');
    }
    if (args[1].action === 'CREATE') {
      await pauseAt('admission-inserted');
    }
    return record(...args);
  };

  const assertHospital = container.services.units.assertHospital;
  container.services.units.assertHospital = async (...args) => {
    const unit = await assertHospital(...args);
    if (args[1]) {
      await pauseAt('bed-locked');
    }
    return unit;
  };
};

const app = buildApp({ clock: advancingClock, configureContainer });
const request = requester(app);

async function whileAdmissionPaused<T>(at: PausePoint, admit: () => Promise<T>, competing: () => Promise<T>): Promise<[T, T]> {
  let held!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (held = resolve));
  admissionGate = { at, held, release: new Promise<void>((resolve) => (release = resolve)) };

  const first = admit();
  await reached;
  const second = competing();
  await new Promise((resolve) => setTimeout(resolve, 200));
  release();
  return Promise.all([first, second]);
}

type Setup = Awaited<ReturnType<typeof hospital>>;

function admitBody(setup: Setup, overrides: Record<string, unknown> = {}) {
  return { patientId: setup.patient.patient.id, bedId: setup.bed.id, responsibleProfessionalId: setup.responsible.professional.id, ...overrides };
}

async function admitted(setup: Setup) {
  return insertAdmission({ patientId: setup.patient.patient.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.bed });
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  auditFails = false;
  admissionGate = null;
  await clearAuditLogs();
  await clearUnits();
  await clearUsers();
});

describe('POST /admissions', () => {
  it('admits the patient, occupies the bed, records the ADMISSION movement and a CREATE log', async () => {
    const setup = await hospital(app);

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      patient: { id: setup.patient.patient.id, name: 'Maria da Silva' },
      responsibleProfessional: { id: setup.responsible.professional.id, name: 'Dra. Ana Lima' },
      unit: { id: setup.unit.id, name: 'Hospital Central' },
      currentBed: { id: setup.bed.id, identification: 'ENF-01', type: 'WARD' },
      status: 'ACTIVE',
      dischargedAt: null,
      movements: [{ type: 'ADMISSION', fromBed: null, toBed: { id: setup.bed.id, identification: 'ENF-01' } }],
    });
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');

    const [movement] = await findMovementRows();
    expect(movement).toMatchObject({ admissionId: body.id, type: 'ADMISSION', fromBedId: null, toBedId: setup.bed.id });
    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'CREATE', resourceType: 'ADMISSION', resourceId: body.id, patientId: setup.patient.patient.id });
  });

  it('rejects a patient who is already admitted with 409', async () => {
    const setup = await hospital(app);
    await admitted(setup);

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { bedId: setup.otherBed.id }));

    expect(response.statusCode).toBe(409);
    expect(await bedStatus(setup.otherBed.id)).toBe('AVAILABLE');
  });

  it('rejects an OCCUPIED bed with 409', async () => {
    const setup = await hospital(app);
    const { patient: other } = await insertPatient({ name: 'João' });
    await insertAdmission({ patientId: other.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.bed });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup));

    expect(response.statusCode).toBe(409);
  });

  it.each(['CLEANING', 'MAINTENANCE'] as const)('rejects a %s bed with 422', async (status) => {
    const setup = await hospital(app);
    const bed = await insertBed(setup.unit, { status });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { bedId: bed.id }));

    expect(response.statusCode).toBe(422);
    expect(await findAdmissionRows()).toHaveLength(0);
  });

  it('rejects a professional who is not linked to the unit of the bed with 422', async () => {
    const setup = await hospital(app);
    const { professional } = await insertProfessional({ unitIds: [(await insertUnit({ type: 'HOSPITAL' })).id] });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { responsibleProfessionalId: professional.id }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Responsible professional is not linked to the unit of the bed');
  });

  it('rejects an inactive professional with 422', async () => {
    const setup = await hospital(app);
    const { professional } = await insertProfessional({ unitIds: [setup.unit.id], active: false });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { responsibleProfessionalId: professional.id }));

    expect(response.statusCode).toBe(422);
  });

  it('rejects an inactive patient with 422', async () => {
    const setup = await hospital(app);
    const { patient } = await insertPatient({ active: false });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { patientId: patient.id }));

    expect(response.statusCode).toBe(422);
  });

  it.each(['patientId', 'bedId', 'responsibleProfessionalId'])('returns 404 for an unknown %s', async (field) => {
    const setup = await hospital(app);

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { [field]: randomUUID() }));

    expect(response.statusCode).toBe(404);
  });

  it('lets only one of two simultaneous admissions to the same bed succeed', async () => {
    const setup = await hospital(app);
    const { patient: other } = await insertPatient({ name: 'João' });

    const [first, second] = await whileAdmissionPaused(
      'bed-locked',
      () => request('POST', '/admissions', setup.adminToken, admitBody(setup)),
      () => request('POST', '/admissions', setup.adminToken, admitBody(setup, { patientId: other.id })),
    );

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toBe('Bed is no longer available');
    expect(await findAdmissionRows()).toHaveLength(1);
    expect(await findMovementRows()).toHaveLength(1);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
  });

  it('lets the unique index reject a simultaneous admission of the same patient in another bed', async () => {
    const setup = await hospital(app);

    const [first, second] = await whileAdmissionPaused(
      'admission-inserted',
      () => request('POST', '/admissions', setup.adminToken, admitBody(setup)),
      () => request('POST', '/admissions', setup.adminToken, admitBody(setup, { bedId: setup.otherBed.id })),
    );

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toBe('Resource already exists');
    expect(await findAdmissionRows()).toHaveLength(1);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect(await bedStatus(setup.otherBed.id)).toBe('AVAILABLE');
  });

  it('never leaves an active admission in a MAINTENANCE bed when both run at the same time', async () => {
    const setup = await hospital(app);

    const [admission, maintenance] = await whileAdmissionPaused(
      'bed-locked',
      () => request('POST', '/admissions', setup.adminToken, admitBody(setup)),
      () => request('PATCH', `/beds/${setup.bed.id}/status`, setup.adminToken, { status: 'MAINTENANCE' }),
    );

    expect(admission.statusCode).toBe(201);
    expect(maintenance.statusCode).toBe(422);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect((await findAdmissionRows()).filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
  });

  it('rejects an admission to a bed sent to MAINTENANCE first with 422', async () => {
    const setup = await hospital(app);

    const maintenance = await request('PATCH', `/beds/${setup.bed.id}/status`, setup.adminToken, { status: 'MAINTENANCE' });
    const admission = await request('POST', '/admissions', setup.adminToken, admitBody(setup));

    expect(maintenance.statusCode).toBe(200);
    expect(admission.statusCode).toBe(422);
    expect(await findAdmissionRows()).toHaveLength(0);
  });

  it('keeps everything unchanged when the audit log cannot be written', async () => {
    const setup = await hospital(app);
    auditFails = true;

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup));

    expect(response.statusCode).toBe(500);
    expect(await findAdmissionRows()).toHaveLength(0);
    expect(await findMovementRows()).toHaveLength(0);
    expect(await bedStatus(setup.bed.id)).toBe('AVAILABLE');
  });
});

describe('POST /admissions/:admissionId/transfer', () => {
  it('moves the patient to the new bed, sends the previous one to CLEANING and records a TRANSFER', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    await clearAuditLogs();

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.currentBed.id).toBe(setup.otherBed.id);
    expect(body.movements.map((movement: { type: string }) => movement.type)).toEqual(['ADMISSION', 'TRANSFER']);
    expect(body.movements[1]).toMatchObject({ fromBed: { id: setup.bed.id }, toBed: { id: setup.otherBed.id } });
    expect(await bedStatus(setup.otherBed.id)).toBe('OCCUPIED');
    expect(await bedStatus(setup.bed.id)).toBe('CLEANING');
    const [row] = await findAdmissionRows();
    expect(row.currentBedId).toBe(setup.otherBed.id);
    expect(await findAuditLogs()).toEqual([
      expect.objectContaining({ action: 'UPDATE', resourceType: 'ADMISSION', resourceId: admission.id, patientId: admission.patientId }),
    ]);
  });

  it('rejects a bed of another unit with 422', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    const elsewhere = await insertBed(await insertUnit({ type: 'HOSPITAL' }));

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: elsewhere.id });

    expect(response.statusCode).toBe(422);
    expect(await bedStatus(elsewhere.id)).toBe('AVAILABLE');
  });

  it('rejects a destination that is no longer free with 409 and changes nothing', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    const { patient: other } = await insertPatient({ name: 'João' });
    await insertAdmission({ patientId: other.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.otherBed });

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id });

    expect(response.statusCode).toBe(409);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect((await findAdmissionRows()).find((row) => row.id === admission.id)?.currentBedId).toBe(setup.bed.id);
    expect(await findMovementRows()).toHaveLength(2);
  });

  it('rejects a CLEANING destination with 422', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    const cleaning = await insertBed(setup.unit, { status: 'CLEANING' });

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: cleaning.id });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a DISCHARGED admission with 422', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    await dischargeAdmission(admission, setup.bed);

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id });

    expect(response.statusCode).toBe(422);
    expect(await bedStatus(setup.otherBed.id)).toBe('AVAILABLE');
  });

  it.each(['admission', 'bed'])('returns 404 for an unknown %s', async (unknown) => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    const admissionId = unknown === 'admission' ? randomUUID() : admission.id;
    const toBedId = unknown === 'bed' ? randomUUID() : setup.otherBed.id;

    const response = await request('POST', `/admissions/${admissionId}/transfer`, setup.adminToken, { toBedId });

    expect(response.statusCode).toBe(404);
  });

  it('does not deadlock on two crossed transfers', async () => {
    const setup = await hospital(app);
    const { patient: other } = await insertPatient({ name: 'João' });
    const first = await admitted(setup);
    const second = await insertAdmission({ patientId: other.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.otherBed });

    const responses = await Promise.all([
      request('POST', `/admissions/${first.id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id }),
      request('POST', `/admissions/${second.id}/transfer`, setup.adminToken, { toBedId: setup.bed.id }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([409, 409]);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect(await bedStatus(setup.otherBed.id)).toBe('OCCUPIED');
  });

  it('lets only one of two simultaneous transfers to the same bed succeed', async () => {
    const setup = await hospital(app);
    const { patient: other } = await insertPatient({ name: 'João' });
    const first = await admitted(setup);
    const second = await insertAdmission({ patientId: other.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.otherBed });
    const target = await insertBed(setup.unit, { identification: 'ENF-03' });

    const responses = await Promise.all([
      request('POST', `/admissions/${first.id}/transfer`, setup.adminToken, { toBedId: target.id }),
      request('POST', `/admissions/${second.id}/transfer`, setup.adminToken, { toBedId: target.id }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await findAdmissionRows()).filter((row) => row.currentBedId === target.id)).toHaveLength(1);
  });

  it('keeps everything unchanged when the audit log cannot be written', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    auditFails = true;

    const response = await request('POST', `/admissions/${admission.id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id });

    expect(response.statusCode).toBe(500);
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect(await bedStatus(setup.otherBed.id)).toBe('AVAILABLE');
    expect((await findAdmissionRows())[0].currentBedId).toBe(setup.bed.id);
    expect(await findMovementRows()).toHaveLength(1);
  });
});

describe('POST /admissions/:admissionId/discharge', () => {
  it('discharges the admission, sends the bed to CLEANING and records a DISCHARGE', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);

    const response = await request('POST', `/admissions/${admission.id}/discharge`, setup.adminToken);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('DISCHARGED');
    expect(body.dischargedAt).toEqual(expect.any(String));
    expect(body.currentBed.id).toBe(setup.bed.id);
    expect(body.movements[1]).toMatchObject({ type: 'DISCHARGE', fromBed: { id: setup.bed.id }, toBed: null });
    expect(await bedStatus(setup.bed.id)).toBe('CLEANING');
    const [row] = await findAdmissionRows();
    expect(row.status).toBe('DISCHARGED');
    expect(row.dischargedAt).toEqual(new Date(body.dischargedAt));
    expect(await findAuditLogs()).toEqual([expect.objectContaining({ action: 'UPDATE', resourceType: 'ADMISSION', resourceId: admission.id })]);
  });

  it('rejects a second discharge with 422', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    await dischargeAdmission(admission, setup.bed);

    const response = await request('POST', `/admissions/${admission.id}/discharge`, setup.adminToken);

    expect(response.statusCode).toBe(422);
    expect(await findMovementRows()).toHaveLength(2);
  });

  it('frees the patient for a new admission in another unit', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    await request('POST', `/admissions/${admission.id}/discharge`, setup.adminToken);
    const otherUnit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(otherUnit);
    const { professional } = await insertProfessional({ unitIds: [otherUnit.id] });

    const response = await request('POST', '/admissions', setup.adminToken, admitBody(setup, { bedId: bed.id, responsibleProfessionalId: professional.id }));

    expect(response.statusCode).toBe(201);
  });

  it('keeps everything unchanged when the audit log cannot be written', async () => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    auditFails = true;

    const response = await request('POST', `/admissions/${admission.id}/discharge`, setup.adminToken);

    expect(response.statusCode).toBe(500);
    expect((await findAdmissionRows())[0]).toMatchObject({ status: 'ACTIVE', dischargedAt: null });
    expect(await bedStatus(setup.bed.id)).toBe('OCCUPIED');
    expect(await findMovementRows()).toHaveLength(1);
  });

  it('returns 404 for an unknown admission', async () => {
    const response = await request('POST', `/admissions/${randomUUID()}/discharge`, await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /admissions/:admissionId', () => {
  async function transferred() {
    const setup = await hospital(app);
    await request('POST', '/admissions', setup.adminToken, admitBody(setup));
    const [{ id }] = await findAdmissionRows();
    await request('POST', `/admissions/${id}/transfer`, setup.adminToken, { toBedId: setup.otherBed.id });
    await clearAuditLogs();
    return { ...setup, id };
  }

  it.each(['admin', 'responsible', 'patient'] as const)('shows the %s the admission with its movements in order and records a READ', async (who) => {
    const setup = await transferred();
    const token = { admin: setup.adminToken, responsible: setup.responsible.token, patient: setup.patient.token }[who];

    const response = await request('GET', `/admissions/${setup.id}`, token);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      patient: { name: 'Maria da Silva' },
      responsibleProfessional: { name: 'Dra. Ana Lima' },
      currentBed: { id: setup.otherBed.id, identification: 'ENF-02' },
      status: 'ACTIVE',
    });
    expect(body.movements.map((movement: { type: string }) => movement.type)).toEqual(['ADMISSION', 'TRANSFER']);
    expect(body.movements[0].occurredAt < body.movements[1].occurredAt).toBe(true);
    expect(await findAuditLogs()).toEqual([
      expect.objectContaining({ action: 'READ', resourceType: 'ADMISSION', resourceId: setup.id, patientId: setup.patient.patient.id }),
    ]);
  });

  it('rejects a professional who is not responsible with 403 and records ACCESS_DENIED', async () => {
    const setup = await transferred();
    const { user } = await insertProfessional({ unitIds: [setup.unit.id] });

    const response = await request('GET', `/admissions/${setup.id}`, signToken(app, user));

    expect(response.statusCode).toBe(403);
    expect(await findAuditLogs()).toEqual([expect.objectContaining({ action: 'ACCESS_DENIED', resourceType: 'ADMISSION', resourceId: setup.id })]);
  });

  it('rejects another patient with 403', async () => {
    const setup = await transferred();
    const { user } = await insertPatient({ name: 'João' });

    const response = await request('GET', `/admissions/${setup.id}`, signToken(app, user));

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for an unknown admission', async () => {
    const response = await request('GET', `/admissions/${randomUUID()}`, await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /admissions', () => {
  it('lists admissions newest first, filtered by unit and status', async () => {
    const setup = await hospital(app);
    const { patient: other } = await insertPatient({ name: 'João' });
    const old = await insertAdmission(
      { patientId: other.id, responsibleProfessionalId: setup.responsible.professional.id, bed: setup.otherBed },
      new Date('2026-10-01T12:00:00.000Z'),
    );
    await dischargeAdmission(old, setup.otherBed, new Date('2026-10-05T12:00:00.000Z'));
    const recent = await admitted(setup);
    const elsewhere = await insertUnit({ type: 'HOSPITAL' });
    const { professional } = await insertProfessional({ unitIds: [elsewhere.id] });
    const { patient: third } = await insertPatient();
    await insertAdmission({ patientId: third.id, responsibleProfessionalId: professional.id, bed: await insertBed(elsewhere) });

    const all = await request('GET', `/admissions?unitId=${setup.unit.id}`, setup.adminToken);
    const active = await request('GET', `/admissions?unitId=${setup.unit.id}&status=ACTIVE`, setup.adminToken);

    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(all.json().items.map((item: { id: string }) => item.id)).toEqual([recent.id, old.id]);
    expect(active.json().items.map((item: { id: string }) => item.id)).toEqual([recent.id]);
    expect(active.json().items[0]).toMatchObject({ patient: { name: 'Maria da Silva' }, currentBed: { identification: 'ENF-01' } });
  });

  it('rejects an invalid status with 400', async () => {
    const response = await request('GET', '/admissions?status=OPEN', await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(400);
  });
});

describe('admission operations access', () => {
  it.each(['PATIENT', 'PROFESSIONAL'] as Role[])('reject %s with 403', async (role) => {
    const setup = await hospital(app);
    const admission = await admitted(setup);
    const token = await tokenFor(app, role);

    const responses = await Promise.all([
      request('POST', '/admissions', token, admitBody(setup, { bedId: setup.otherBed.id })),
      request('POST', `/admissions/${admission.id}/transfer`, token, { toBedId: setup.otherBed.id }),
      request('POST', `/admissions/${admission.id}/discharge`, token),
      request('GET', '/admissions', token),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
  });
});
