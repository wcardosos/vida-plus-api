import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { env } from '../../src/env';
import { LgpdConsent } from '../../src/modules/lgpd/entities/lgpd-consent.entity';
import { createLgpdConsentRepository } from '../../src/modules/lgpd/repositories/lgpd-consent.repository';
import type { AppointmentNotifier } from '../../src/modules/scheduling/services/appointment-notifier';
import {
  clearUnits,
  clearUsers,
  findAppointments,
  findConsents,
  insertAppointment,
  insertPatient,
  insertProfessional,
  insertUnit,
  signToken,
  tokenFor,
} from './helpers';
import { clock, localTime, monday, now, requester } from './scheduling-helpers';

const notifications: string[] = [];

const notifier: AppointmentNotifier = {
  async appointmentScheduled(appointment) {
    notifications.push(`scheduled:${appointment.id}`);
  },
  async appointmentCanceled(appointment) {
    notifications.push(`canceled:${appointment.id}:${appointment.canceledBy}`);
  },
};

const app = buildApp({ clock, appointmentNotifier: notifier });
const request = requester(app);
const consentRepository = createLgpdConsentRepository(db);

async function insertConsent(patientId: string, grantedAt: Date, revokedAt?: Date): Promise<LgpdConsent> {
  const consent = LgpdConsent.grant(patientId, 'TELECONSULTATION', '2026-01', grantedAt);
  if (revokedAt) {
    consent.revoke(revokedAt);
  }
  await consentRepository.insert(consent);
  return consent;
}

async function setup() {
  const unit = await insertUnit();
  const { professional } = await insertProfessional({ unitIds: [unit.id] });
  const { patient, user } = await insertPatient();
  return { unit, professional, patient, token: signToken(app, user) };
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  notifications.length = 0;
  await clearUnits();
  await clearUsers();
});

describe('GET /me/consents', () => {
  it('lists the active and revoked consents of the authenticated patient, newest first', async () => {
    const { patient, token } = await setup();
    const older = await insertConsent(patient.id, new Date('2026-09-01T10:00:00.000Z'), new Date('2026-09-15T10:00:00.000Z'));
    const newer = await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));
    const { patient: other } = await insertPatient();
    await insertConsent(other.id, new Date('2026-10-02T10:00:00.000Z'));

    const response = await request('GET', '/me/consents', token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: newer.id,
        purpose: 'TELECONSULTATION',
        termsVersion: '2026-01',
        grantedAt: '2026-10-01T10:00:00.000Z',
        revokedAt: null,
        active: true,
      },
      {
        id: older.id,
        purpose: 'TELECONSULTATION',
        termsVersion: '2026-01',
        grantedAt: '2026-09-01T10:00:00.000Z',
        revokedAt: '2026-09-15T10:00:00.000Z',
        active: false,
      },
    ]);
  });

  it.each(['PROFESSIONAL', 'ADMIN'] as const)('responds 403 to a %s', async (role) => {
    expect((await request('GET', '/me/consents', await tokenFor(app, role))).statusCode).toBe(403);
  });

  it('responds 404 to a PATIENT user without a patient record', async () => {
    expect((await request('GET', '/me/consents', await tokenFor(app, 'PATIENT'))).statusCode).toBe(404);
  });

  it('responds 401 without a token', async () => {
    expect((await request('GET', '/me/consents')).statusCode).toBe(401);
  });
});

describe('POST /me/consents', () => {
  it('grants the consent under the current terms version', async () => {
    const { patient, token } = await setup();

    const response = await request('POST', '/me/consents', token, { purpose: 'TELECONSULTATION' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      purpose: 'TELECONSULTATION',
      termsVersion: env.TERMS_VERSION,
      grantedAt: now.toISOString(),
      revokedAt: null,
      active: true,
    });
    expect(await findConsents()).toMatchObject([
      { id: response.json().id, patientId: patient.id, termsVersion: env.TERMS_VERSION, grantedAt: now, revokedAt: null },
    ]);
  });

  it('grants a new consent after the previous one was revoked', async () => {
    const { patient, token } = await setup();
    await insertConsent(patient.id, new Date('2026-09-01T10:00:00.000Z'), new Date('2026-09-15T10:00:00.000Z'));

    const response = await request('POST', '/me/consents', token, { purpose: 'TELECONSULTATION' });

    expect(response.statusCode).toBe(201);
    expect(await findConsents()).toHaveLength(2);
  });

  it('responds 409 while an active consent for the purpose exists', async () => {
    const { patient, token } = await setup();
    await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));

    const response = await request('POST', '/me/consents', token, { purpose: 'TELECONSULTATION' });

    expect(response.statusCode).toBe(409);
    expect(await findConsents()).toHaveLength(1);
  });

  it('keeps at most one active consent per purpose at the database level', async () => {
    const { patient } = await setup();
    await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));

    await expect(insertConsent(patient.id, new Date('2026-10-02T10:00:00.000Z'))).rejects.toThrow();
  });

  it('responds 400 to an unknown purpose', async () => {
    const { token } = await setup();

    expect((await request('POST', '/me/consents', token, { purpose: 'MARKETING' })).statusCode).toBe(400);
  });

  it('responds 403 to a PROFESSIONAL', async () => {
    const response = await request('POST', '/me/consents', await tokenFor(app, 'PROFESSIONAL'), { purpose: 'TELECONSULTATION' });

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /me/consents/:consentId/revoke', () => {
  function revoke(token: string, consentId: string) {
    return request('POST', `/me/consents/${consentId}/revoke`, token);
  }

  it('revokes the consent and cancels the future teleconsultations of the patient', async () => {
    const { unit, professional, patient, token } = await setup();
    const consent = await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));
    const base = { patientId: patient.id, professionalId: professional.id, unitId: unit.id };
    const first = await insertAppointment({ ...base, modality: 'TELECONSULTATION', startsAt: localTime(monday, '09:00') });
    const second = await insertAppointment({ ...base, modality: 'TELECONSULTATION', startsAt: localTime(monday, '10:00') });
    const inPerson = await insertAppointment({ ...base, modality: 'IN_PERSON', startsAt: localTime(monday, '11:00') });
    const past = await insertAppointment({ ...base, modality: 'TELECONSULTATION', startsAt: localTime('2026-10-09', '09:00') });
    const { patient: other } = await insertPatient();
    const otherPatient = await insertAppointment({
      ...base,
      patientId: other.id,
      modality: 'TELECONSULTATION',
      startsAt: localTime(monday, '14:00'),
    });

    const response = await revoke(token, consent.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      consent: {
        id: consent.id,
        purpose: 'TELECONSULTATION',
        termsVersion: '2026-01',
        grantedAt: '2026-10-01T10:00:00.000Z',
        revokedAt: now.toISOString(),
        active: false,
      },
      effects: [
        {
          type: 'CANCELED_TELECONSULTATIONS',
          count: 2,
          appointments: [
            { id: first.id, startsAt: first.startsAt.toISOString() },
            { id: second.id, startsAt: second.startsAt.toISOString() },
          ],
        },
      ],
    });
    expect(await findConsents()).toMatchObject([{ id: consent.id, revokedAt: now }]);

    const statuses = new Map((await findAppointments()).map((row) => [row.id, row]));
    for (const canceled of [first, second]) {
      expect(statuses.get(canceled.id)).toMatchObject({
        status: 'CANCELED',
        canceledBy: 'PATIENT',
        canceledAt: now,
        cancellationReason: 'Teleconsultation consent revoked by the patient',
      });
    }
    for (const kept of [inPerson, past, otherPatient]) {
      expect(statuses.get(kept.id)).toMatchObject({ status: 'SCHEDULED' });
    }
    expect(notifications.sort()).toEqual([`canceled:${first.id}:PATIENT`, `canceled:${second.id}:PATIENT`].sort());
  });

  it('reports no effects when the patient has no future teleconsultation', async () => {
    const { patient, token } = await setup();
    const consent = await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));

    const response = await revoke(token, consent.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().effects).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('responds 422 to a consent that was already revoked', async () => {
    const { patient, token } = await setup();
    const revokedAt = new Date('2026-10-05T10:00:00.000Z');
    const consent = await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'), revokedAt);

    const response = await revoke(token, consent.id);

    expect(response.statusCode).toBe(422);
    expect(await findConsents()).toMatchObject([{ id: consent.id, revokedAt }]);
  });

  it('responds 404 to a consent of another patient and leaves it active', async () => {
    const { token } = await setup();
    const { patient: other } = await insertPatient();
    const consent = await insertConsent(other.id, new Date('2026-10-01T10:00:00.000Z'));

    const response = await revoke(token, consent.id);

    expect(response.statusCode).toBe(404);
    expect(await findConsents()).toMatchObject([{ id: consent.id, revokedAt: null }]);
  });

  it('responds 404 to an unknown consent', async () => {
    const { token } = await setup();

    expect((await revoke(token, randomUUID())).statusCode).toBe(404);
  });

  it('responds 403 to an ADMIN', async () => {
    const { patient } = await setup();
    const consent = await insertConsent(patient.id, new Date('2026-10-01T10:00:00.000Z'));

    expect((await revoke(await tokenFor(app, 'ADMIN'), consent.id)).statusCode).toBe(403);
  });
});
