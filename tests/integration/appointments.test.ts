import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { LgpdConsent } from '../../src/modules/lgpd/entities/lgpd-consent.entity';
import { createLgpdConsentRepository } from '../../src/modules/lgpd/repositories/lgpd-consent.repository';
import type { Appointment } from '../../src/modules/scheduling/entities/appointment.entity';
import type { AppointmentNotifier } from '../../src/modules/scheduling/services/appointment-notifier';
import {
  clearUnits,
  clearUsers,
  findAppointments,
  findConsents,
  insertAppointment,
  insertAvailability,
  insertBlock,
  insertPatient,
  insertProfessional,
  insertUnit,
  signToken,
  tokenFor,
} from './helpers';
import { clock, localTime, monday, now, requester } from './scheduling-helpers';

const notifications: string[] = [];
let notifierFails = false;

const notifier: AppointmentNotifier = {
  async appointmentScheduled(appointment: Appointment) {
    if (notifierFails) throw new Error('provider down');
    notifications.push(`scheduled:${appointment.id}`);
  },
  async appointmentCanceled(appointment: Appointment) {
    if (notifierFails) throw new Error('provider down');
    notifications.push(`canceled:${appointment.id}:${appointment.canceledBy}`);
  },
};

const app = buildApp({ clock, appointmentNotifier: notifier });
const request = requester(app);

async function setup() {
  const centro = await insertUnit({ name: 'Unidade Centro' });
  const { professional, user: professionalUser } = await insertProfessional({ name: 'Dra. Ana', unitIds: [centro.id] });
  await insertAvailability({ professionalId: professional.id, unitId: centro.id, startTime: '08:00', endTime: '12:00', slotMinutes: 30 });
  const { patient, user: patientUser } = await insertPatient({ name: 'Maria' });
  return {
    centro,
    professional,
    patient,
    professionalToken: signToken(app, professionalUser),
    patientToken: signToken(app, patientUser),
  };
}

function bookingBody(professionalId: string, unitId: string, overrides: Record<string, unknown> = {}) {
  return { professionalId, unitId, modality: 'IN_PERSON', startsAt: localTime(monday, '09:00').toISOString(), ...overrides };
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
  notifierFails = false;
  await clearUnits();
  await clearUsers();
});

describe('POST /appointments', () => {
  it('books a free in-person slot and notifies the confirmation', async () => {
    const { centro, professional, patient, patientToken } = await setup();

    const response = await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      patient: { id: patient.id, name: 'Maria' },
      professional: { id: professional.id, name: 'Dra. Ana' },
      unit: { id: centro.id, name: 'Unidade Centro' },
      modality: 'IN_PERSON',
      status: 'SCHEDULED',
      startsAt: '2026-10-12T12:00:00.000Z',
      endsAt: '2026-10-12T12:30:00.000Z',
      cancellationReason: null,
      canceledBy: null,
      canceledAt: null,
      createdAt: now.toISOString(),
    });
    expect(notifications).toEqual([`scheduled:${response.json().id}`]);
  });

  it.each([
    ['off the slot grid', { startsAt: localTime(monday, '09:10').toISOString() }],
    ['without availability', { startsAt: localTime(monday, '14:00').toISOString() }],
    ['in another modality', { modality: 'TELECONSULTATION', acceptTeleconsultationTerms: true }],
  ])('responds 422 for a time %s', async (_, overrides) => {
    const { centro, professional, patientToken } = await setup();

    const response = await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id, overrides));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('startsAt is not an available slot of the professional for this unit and modality');
    expect(await findAppointments()).toHaveLength(0);
  });

  it('responds 422 for a slot inside a block', async () => {
    const { centro, professional, patientToken } = await setup();
    await insertBlock({ professionalId: professional.id, startsAt: localTime(monday, '08:45'), endsAt: localTime(monday, '09:15'), reason: 'Reunião' });

    expect((await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id))).statusCode).toBe(422);
  });

  it('responds 422 for a slot in the past', async () => {
    const { centro, professional, patientToken } = await setup();
    await insertAvailability({ professionalId: professional.id, unitId: centro.id, weekday: 7, startTime: '07:00', endTime: '08:00' });

    const response = await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id, { startsAt: localTime('2026-10-11', '07:00').toISOString() }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('startsAt must be in the future');
  });

  it('responds 422 for a unit the slot does not belong to', async () => {
    const { professional, patientToken } = await setup();
    const other = await insertUnit();

    expect((await request('POST', '/appointments', patientToken, bookingBody(professional.id, other.id))).statusCode).toBe(422);
  });

  it('responds 422 for an unknown or inactive professional', async () => {
    const { centro, patientToken } = await setup();
    const { professional: inactive } = await insertProfessional({ unitIds: [centro.id], active: false });
    await insertAvailability({ professionalId: inactive.id, unitId: centro.id });

    expect((await request('POST', '/appointments', patientToken, bookingBody(randomUUID(), centro.id))).statusCode).toBe(422);
    expect((await request('POST', '/appointments', patientToken, bookingBody(inactive.id, centro.id))).statusCode).toBe(422);
  });

  it('responds 409 for a slot already taken', async () => {
    const { centro, professional, patientToken } = await setup();
    const { patient: other } = await insertPatient();
    await insertAppointment({ patientId: other.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '09:00') });

    expect((await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id))).statusCode).toBe(409);
  });

  it('accepts exactly one of two concurrent bookings of the same slot', async () => {
    const { centro, professional, patientToken } = await setup();
    const { user: otherUser } = await insertPatient();

    const responses = await Promise.all([
      request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id)),
      request('POST', '/appointments', signToken(app, otherUser), bookingBody(professional.id, centro.id)),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await findAppointments()).toHaveLength(1);
  });

  it('books again a slot whose appointment was canceled', async () => {
    const { centro, professional, patientToken } = await setup();
    const { patient: other } = await insertPatient();
    await insertAppointment({
      patientId: other.id,
      professionalId: professional.id,
      unitId: centro.id,
      startsAt: localTime(monday, '09:00'),
      status: 'CANCELED',
      cancellationReason: 'Imprevisto',
    });

    expect((await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id))).statusCode).toBe(201);
  });

  it('responds 422 when the patient has another appointment at the same time', async () => {
    const { centro, professional, patient, patientToken } = await setup();
    const { professional: other } = await insertProfessional({ unitIds: [centro.id] });
    await insertAppointment({ patientId: patient.id, professionalId: other.id, unitId: centro.id, startsAt: localTime(monday, '09:00') });

    const response = await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Patient already has another appointment at this time');
  });

  describe('teleconsultation', () => {
    async function teleSetup() {
      const context = await setup();
      await insertAvailability({
        professionalId: context.professional.id,
        unitId: context.centro.id,
        startTime: '14:00',
        endTime: '16:00',
        modality: 'TELECONSULTATION',
      });
      const body = (overrides: Record<string, unknown> = {}) =>
        bookingBody(context.professional.id, context.centro.id, { modality: 'TELECONSULTATION', startsAt: localTime(monday, '14:00').toISOString(), ...overrides });
      return { ...context, body };
    }

    it('responds 422 CONSENT_REQUIRED without consent, then grants it in the same booking', async () => {
      const { patient, patientToken, centro, body } = await teleSetup();

      const refused = await request('POST', '/appointments', patientToken, body());

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ statusCode: 422, code: 'CONSENT_REQUIRED' });
      expect(await findConsents()).toHaveLength(0);

      const accepted = await request('POST', '/appointments', patientToken, body({ acceptTeleconsultationTerms: true }));

      expect(accepted.statusCode).toBe(201);
      expect(accepted.json()).toMatchObject({ modality: 'TELECONSULTATION', unit: { id: centro.id } });
      expect(await findConsents()).toMatchObject([{ patientId: patient.id, purpose: 'TELECONSULTATION', grantedAt: now, revokedAt: null }]);
    });

    it('does not grant the consent when the booking fails', async () => {
      const { centro, professional, patientToken, body } = await teleSetup();
      const { patient: other } = await insertPatient();
      await insertAppointment({ patientId: other.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '14:00') });

      expect((await request('POST', '/appointments', patientToken, body({ acceptTeleconsultationTerms: true }))).statusCode).toBe(409);
      expect(await findConsents()).toHaveLength(0);
    });

    it('books with an existing active consent without granting another', async () => {
      const { patient, patientToken, body } = await teleSetup();
      await createLgpdConsentRepository(db).insert(LgpdConsent.grant(patient.id, 'TELECONSULTATION', '2026-10', now));

      expect((await request('POST', '/appointments', patientToken, body())).statusCode).toBe(201);
      expect(await findConsents()).toHaveLength(1);
    });
  });

  it('keeps the appointment when the notifier fails', async () => {
    const { centro, professional, patientToken } = await setup();
    notifierFails = true;

    const response = await request('POST', '/appointments', patientToken, bookingBody(professional.id, centro.id));

    expect(response.statusCode).toBe(201);
    expect(await findAppointments()).toMatchObject([{ id: response.json().id, status: 'SCHEDULED' }]);
  });

  it('responds 403 to a professional', async () => {
    const { centro, professional, professionalToken } = await setup();

    expect((await request('POST', '/appointments', professionalToken, bookingBody(professional.id, centro.id))).statusCode).toBe(403);
  });
});

describe('appointments exclusion constraint', () => {
  it('rejects an overlapping appointment inserted directly, unless the first one is canceled', async () => {
    const { centro, professional, patient } = await setup();
    const first = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:00') });

    await expect(
      insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:20') }),
    ).rejects.toMatchObject({ cause: { code: '23P01' } });
    await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:30') });

    await request('POST', `/appointments/${first.id}/cancel`, signToken(app, { id: patient.userId, role: 'PATIENT' }), { reason: 'Imprevisto' });
    await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:00') });

    expect(await findAppointments()).toHaveLength(3);
  });
});

describe('POST /appointments/:id/cancel', () => {
  async function scheduled() {
    const context = await setup();
    const appointment = await insertAppointment({
      patientId: context.patient.id,
      professionalId: context.professional.id,
      unitId: context.centro.id,
      startsAt: localTime(monday, '09:00'),
    });
    return { ...context, appointment };
  }

  it('lets the patient cancel, frees the slot and notifies', async () => {
    const { appointment, professional, patientToken } = await scheduled();

    const response = await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: ' Imprevisto ' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'CANCELED',
      canceledBy: 'PATIENT',
      cancellationReason: 'Imprevisto',
      canceledAt: now.toISOString(),
    });
    expect(notifications).toEqual([`canceled:${appointment.id}:PATIENT`]);
    const slots = await request(
      'GET',
      `/schedule/free-slots?professionalId=${professional.id}&from=2026-10-12T11:59:00Z&to=2026-10-12T12:31:00Z`,
      patientToken,
    );
    expect(slots.json()).toEqual([expect.objectContaining({ startsAt: '2026-10-12T12:00:00.000Z' })]);
  });

  it('lets the professional cancel', async () => {
    const { appointment, professionalToken } = await scheduled();

    const response = await request('POST', `/appointments/${appointment.id}/cancel`, professionalToken, { reason: 'Férias' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'CANCELED', canceledBy: 'PROFESSIONAL' });
  });

  it('responds 400 for a blank reason', async () => {
    const { appointment, patientToken } = await scheduled();

    expect((await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: '   ' })).statusCode).toBe(400);
  });

  it.each(['CANCELED', 'COMPLETED', 'NO_SHOW'] as const)('responds 422 for a %s appointment', async (status) => {
    const { centro, professional, patient, patientToken } = await setup();
    const appointment = await insertAppointment({
      patientId: patient.id,
      professionalId: professional.id,
      unitId: centro.id,
      startsAt: localTime(monday, '10:00'),
      status,
      cancellationReason: status === 'CANCELED' ? 'x' : null,
    });

    expect((await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: 'Imprevisto' })).statusCode).toBe(422);
  });

  it('responds 422 for an appointment that already started', async () => {
    const { centro, professional, patient, patientToken } = await setup();
    const appointment = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: new Date(now.getTime() - 600_000) });

    const response = await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: 'Imprevisto' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Appointment has already started and can no longer be canceled');
  });

  it("responds 404 for another patient's or another professional's appointment", async () => {
    const { appointment, centro } = await scheduled();
    const { user: otherPatient } = await insertPatient();
    const { user: otherProfessional } = await insertProfessional({ unitIds: [centro.id] });

    expect((await request('POST', `/appointments/${appointment.id}/cancel`, signToken(app, otherPatient), { reason: 'x' })).statusCode).toBe(404);
    expect((await request('POST', `/appointments/${appointment.id}/cancel`, signToken(app, otherProfessional), { reason: 'x' })).statusCode).toBe(404);
    expect((await request('POST', `/appointments/${randomUUID()}/cancel`, signToken(app, otherPatient), { reason: 'x' })).statusCode).toBe(404);
    expect(await findAppointments()).toMatchObject([{ status: 'SCHEDULED' }]);
  });

  it('responds 403 to an admin', async () => {
    const { appointment } = await scheduled();

    expect((await request('POST', `/appointments/${appointment.id}/cancel`, await tokenFor(app, 'ADMIN'), { reason: 'x' })).statusCode).toBe(403);
  });

  it('keeps the cancellation when the notifier fails', async () => {
    const { appointment, patientToken } = await scheduled();
    notifierFails = true;

    expect((await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: 'Imprevisto' })).statusCode).toBe(200);
    expect(await findAppointments()).toMatchObject([{ status: 'CANCELED' }]);
  });
});

describe('POST /appointments/:id/no-show', () => {
  it('marks a started appointment as NO_SHOW, also for a teleconsultation', async () => {
    const { centro, professional, patient, professionalToken } = await setup();
    const appointment = await insertAppointment({
      patientId: patient.id,
      professionalId: professional.id,
      unitId: centro.id,
      modality: 'TELECONSULTATION',
      startsAt: new Date(now.getTime() - 600_000),
    });

    const response = await request('POST', `/appointments/${appointment.id}/no-show`, professionalToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: appointment.id, status: 'NO_SHOW' });
  });

  it('responds 422 before the start or for a closed appointment', async () => {
    const { centro, professional, patient, professionalToken } = await setup();
    const future = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '09:00') });
    const completed = await insertAppointment({
      patientId: patient.id,
      professionalId: professional.id,
      unitId: centro.id,
      startsAt: new Date(now.getTime() - 3_600_000),
      status: 'COMPLETED',
    });

    expect((await request('POST', `/appointments/${future.id}/no-show`, professionalToken)).statusCode).toBe(422);
    expect((await request('POST', `/appointments/${completed.id}/no-show`, professionalToken)).statusCode).toBe(422);
  });

  it('responds 404 for an appointment of another professional and 403 to the patient', async () => {
    const { centro, patient, patientToken } = await setup();
    const { professional: other } = await insertProfessional({ unitIds: [centro.id] });
    const appointment = await insertAppointment({ patientId: patient.id, professionalId: other.id, unitId: centro.id, startsAt: new Date(now.getTime() - 600_000) });
    const { user } = await insertProfessional({ unitIds: [centro.id] });

    expect((await request('POST', `/appointments/${appointment.id}/no-show`, signToken(app, user))).statusCode).toBe(404);
    expect((await request('POST', `/appointments/${appointment.id}/no-show`, patientToken)).statusCode).toBe(403);
  });
});

describe('GET /appointments and /appointments/:id', () => {
  async function listing() {
    const context = await setup();
    const norte = await insertUnit({ name: 'Unidade Norte' });
    const { professional: other, user: otherUser } = await insertProfessional({ unitIds: [norte.id] });
    const { patient: joao, user: joaoUser } = await insertPatient({ name: 'João' });
    const base = { professionalId: context.professional.id, unitId: context.centro.id };
    const mariaLate = await insertAppointment({ ...base, patientId: context.patient.id, startsAt: localTime('2026-10-14', '09:00') });
    const mariaEarly = await insertAppointment({ ...base, patientId: context.patient.id, startsAt: localTime(monday, '09:00'), status: 'CANCELED', cancellationReason: 'x' });
    const joaoOther = await insertAppointment({ professionalId: other.id, unitId: norte.id, patientId: joao.id, startsAt: localTime(monday, '10:00') });
    const joaoOwn = await insertAppointment({ ...base, patientId: joao.id, startsAt: localTime('2026-10-13', '09:00') });
    return { ...context, norte, other, joaoToken: signToken(app, joaoUser), otherToken: signToken(app, otherUser), mariaLate, mariaEarly, joaoOther, joaoOwn };
  }

  const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  it('shows each patient only their own appointments, ignoring the patientId filter', async () => {
    const { patientToken, joaoOwn, mariaEarly, mariaLate } = await listing();

    const response = await request('GET', `/appointments?patientId=${joaoOwn.patientId}`, patientToken);

    expect(response.statusCode).toBe(200);
    expect(ids(response.json())).toEqual([mariaEarly.id, mariaLate.id]);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  it('shows each professional only their own appointments', async () => {
    const { professionalToken, otherToken, joaoOther, mariaEarly, joaoOwn, mariaLate } = await listing();

    expect(ids((await request('GET', '/appointments', professionalToken)).json())).toEqual([mariaEarly.id, joaoOwn.id, mariaLate.id]);
    expect(ids((await request('GET', '/appointments', otherToken)).json())).toEqual([joaoOther.id]);
  });

  it('lets an admin combine unit, status and period filters with pagination', async () => {
    const { centro, joaoOwn, mariaLate, joaoOther, mariaEarly } = await listing();
    const token = await tokenFor(app, 'ADMIN');

    const filtered = await request('GET', `/appointments?unitId=${centro.id}&status=SCHEDULED&from=2026-10-12T03:00:00Z&to=2026-10-15T03:00:00Z`, token);
    const paged = await request('GET', '/appointments?page=2&pageSize=2', token);

    expect(ids(filtered.json())).toEqual([joaoOwn.id, mariaLate.id]);
    expect(paged.json()).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect(ids(paged.json())).toEqual([joaoOwn.id, mariaLate.id]);
    expect(ids((await request('GET', `/appointments?professionalId=${joaoOther.professionalId}`, token)).json())).toEqual([joaoOther.id]);
    expect(ids((await request('GET', `/appointments?patientId=${mariaEarly.patientId}`, token)).json())).toEqual([mariaEarly.id, mariaLate.id]);
  });

  it('responds 400 for an invalid filter', async () => {
    const { patientToken } = await listing();

    expect((await request('GET', '/appointments?status=DONE', patientToken)).statusCode).toBe(400);
    expect((await request('GET', '/appointments?from=2026-10-15T00:00:00Z&to=2026-10-12T00:00:00Z', patientToken)).statusCode).toBe(400);
  });

  it('shows an appointment to its participants and to an admin, and 404 to anyone else', async () => {
    const { mariaLate, patientToken, professionalToken, joaoToken, otherToken } = await listing();
    const url = `/appointments/${mariaLate.id}`;

    expect((await request('GET', url, patientToken)).json()).toMatchObject({ id: mariaLate.id, patient: { name: 'Maria' } });
    expect((await request('GET', url, professionalToken)).statusCode).toBe(200);
    expect((await request('GET', url, await tokenFor(app, 'ADMIN'))).statusCode).toBe(200);
    expect((await request('GET', url, joaoToken)).statusCode).toBe(404);
    expect((await request('GET', url, otherToken)).statusCode).toBe(404);
    expect((await request('GET', `/appointments/${randomUUID()}`, patientToken)).statusCode).toBe(404);
  });
});
