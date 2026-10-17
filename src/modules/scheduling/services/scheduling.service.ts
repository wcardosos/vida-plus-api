import type { FastifyBaseLogger } from 'fastify';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/errors';
import { loggableError } from '../../../shared/logger';
import type { Role } from '../../../shared/roles';
import { addDays, startOfZonedDay, toZonedDate } from '../../../shared/time-zone';
import type { ConsentRevocation, ConsentRevocationOutcome, LgpdService } from '../../lgpd/services/lgpd.service';
import type { PatientsService } from '../../patients/services/patients.service';
import type { ProfessionalDetails, ProfessionalsService } from '../../professionals/services/professionals.service';
import type { UnitsService } from '../../units/services/units.service';
import { Appointment, type AppointmentStatus, type CancellationActor, type Modality } from '../entities/appointment.entity';
import {
  ScheduleAvailability,
  type CreateScheduleAvailabilityProps,
  type Slot,
  type UpdateScheduleAvailabilityProps,
} from '../entities/schedule-availability.entity';
import { ScheduleBlock, type CreateScheduleBlockProps } from '../entities/schedule-block.entity';
import type {
  AppointmentRepository,
  FutureAppointmentsFilter,
  Pagination,
  PatientAppointmentsFilter,
} from '../repositories/appointment.repository';
import type { AvailabilityFilters, ScheduleAvailabilityRepository } from '../repositories/schedule-availability.repository';
import type { Period, ScheduleBlockRepository } from '../repositories/schedule-block.repository';
import type { AppointmentNotifier } from './appointment-notifier';
import { candidateSlots, freeSlots } from './free-slots';

export type SchedulingServiceConfig = {
  timeZone: string;
  termsVersion: string;
};

export type Viewer = {
  id: string;
  role: Role;
};

export type Reference = {
  id: string;
  name: string;
};

export type AppointmentDetails = {
  appointment: Appointment;
  patient: Reference;
  professional: Reference;
  unit: Reference;
};

export type CreateAvailabilityInput = Omit<CreateScheduleAvailabilityProps, 'professionalId'>;

export type CreateBlockInput = Omit<CreateScheduleBlockProps, 'professionalId'>;

export type FreeSlotsQuery = {
  professionalId: string;
  from: Date;
  to: Date;
  modality?: Modality;
  unitId?: string;
};

export type ScheduleAppointmentInput = {
  professionalId: string;
  unitId: string;
  modality: Modality;
  startsAt: Date;
  acceptTeleconsultationTerms?: boolean;
};

export type ListAppointmentsInput = {
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
  professionalId?: string;
  patientId?: string;
  unitId?: string;
};

export type FutureAppointmentsPendency = {
  type: 'FUTURE_APPOINTMENTS';
  count: number;
  appointments: { id: string; startsAt: string }[];
};

type Participant = { by: 'PATIENT'; patientId: string } | { by: 'PROFESSIONAL'; professionalId: string };

const consentRevokedReason = 'Teleconsultation consent revoked by the patient';

export type SchedulingService = ReturnType<typeof createSchedulingService>;

export function createSchedulingService(deps: {
  db: Database;
  logger: FastifyBaseLogger;
  availabilities: ScheduleAvailabilityRepository;
  blocks: ScheduleBlockRepository;
  appointments: AppointmentRepository;
  professionals: ProfessionalsService;
  patients: PatientsService;
  units: UnitsService;
  lgpd: LgpdService;
  notifier: AppointmentNotifier;
  clock: () => Date;
  config: SchedulingServiceConfig;
}) {
  const { db, logger, availabilities, blocks, appointments, professionals, patients, units, lgpd, notifier, clock, config } = deps;
  const { timeZone } = config;

  async function currentProfessionalId(userId: string): Promise<string> {
    return (await professionals.getByUserId(userId)).professional.id;
  }

  async function currentPatientId(userId: string): Promise<string> {
    return (await patients.getByUserId(userId)).patient.id;
  }

  async function participantOf(viewer: Viewer): Promise<Participant> {
    if (viewer.role === 'PATIENT') {
      return { by: 'PATIENT', patientId: await currentPatientId(viewer.id) };
    }
    if (viewer.role === 'PROFESSIONAL') {
      return { by: 'PROFESSIONAL', professionalId: await currentProfessionalId(viewer.id) };
    }
    throw new NotFoundError('Appointment not found');
  }

  function takesPart(participant: Participant, appointment: Appointment): boolean {
    return participant.by === 'PATIENT' ? appointment.patientId === participant.patientId : appointment.professionalId === participant.professionalId;
  }

  function activeUnitIds(details: ProfessionalDetails): Set<string> {
    return new Set(details.units.filter((unit) => unit.isActive()).map((unit) => unit.id));
  }

  async function withReferences(list: Appointment[]): Promise<AppointmentDetails[]> {
    if (list.length === 0) {
      return [];
    }
    const [patientList, professionalList, unitList] = await Promise.all([
      patients.listByIds(list.map((appointment) => appointment.patientId)),
      professionals.listByIds(list.map((appointment) => appointment.professionalId)),
      units.listByIds(list.map((appointment) => appointment.unitId)),
    ]);
    const names = new Map<string, string>([...patientList, ...professionalList, ...unitList].map((item) => [item.id, item.name]));
    const reference = (id: string): Reference => ({ id, name: names.get(id) ?? '' });
    return list.map((appointment) => ({
      appointment,
      patient: reference(appointment.patientId),
      professional: reference(appointment.professionalId),
      unit: reference(appointment.unitId),
    }));
  }

  async function withReference(appointment: Appointment): Promise<AppointmentDetails> {
    const [details] = await withReferences([appointment]);
    return details;
  }

  async function notify(event: string, appointment: Appointment, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      logger.error({ err: loggableError(error), appointmentId: appointment.id }, `failed to send the appointment ${event} notification`);
    }
  }

  async function loadOwnAvailability(professionalId: string, id: string, executor?: DbExecutor): Promise<ScheduleAvailability> {
    const availability = await availabilities.findById(id, executor);
    if (!availability || availability.professionalId !== professionalId) {
      throw new NotFoundError('Availability not found');
    }
    return availability;
  }

  async function ensureUsableUnit(details: ProfessionalDetails, unitId: string, tx: Transaction): Promise<void> {
    if (!details.professional.isLinkedTo(unitId)) {
      throw new DomainError('Professional is not linked to this unit');
    }
    await units.getActiveById(unitId, tx);
  }

  async function saveAvailability(details: ProfessionalDetails, availability: ScheduleAvailability, isNew: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      await ensureUsableUnit(details, availability.unitId, tx);
      await availabilities.lockProfessionalSchedule(availability.professionalId, tx);
      const others = (await availabilities.findByProfessional(availability.professionalId, {}, tx)).filter(
        (other) => other.id !== availability.id,
      );
      if (others.some((other) => other.overlaps(availability))) {
        throw new DomainError('Availability overlaps another availability of the professional');
      }
      if (isNew) {
        await availabilities.insert(availability, tx);
      } else {
        await availabilities.update(availability, tx);
      }
    });
  }

  async function listAvailabilities(userId: string, filters: Pick<AvailabilityFilters, 'unitId'>): Promise<ScheduleAvailability[]> {
    return availabilities.findByProfessional(await currentProfessionalId(userId), filters);
  }

  async function createAvailability(userId: string, input: CreateAvailabilityInput): Promise<ScheduleAvailability> {
    const details = await professionals.getByUserId(userId);
    const availability = ScheduleAvailability.create({ ...input, professionalId: details.professional.id }, clock());
    await saveAvailability(details, availability, true);
    return availability;
  }

  async function updateAvailability(userId: string, id: string, changes: UpdateScheduleAvailabilityProps): Promise<ScheduleAvailability> {
    const details = await professionals.getByUserId(userId);
    const availability = await loadOwnAvailability(details.professional.id, id);
    availability.update(changes);
    await saveAvailability(details, availability, false);
    return availability;
  }

  async function deleteAvailability(userId: string, id: string): Promise<void> {
    const professionalId = await currentProfessionalId(userId);
    await loadOwnAvailability(professionalId, id);
    await availabilities.delete(id);
  }

  async function listBlocks(userId: string, period: Period): Promise<ScheduleBlock[]> {
    return blocks.findOverlapping(await currentProfessionalId(userId), period);
  }

  async function createBlock(userId: string, input: CreateBlockInput): Promise<{ block: ScheduleBlock; affected: AppointmentDetails[] }> {
    const professionalId = await currentProfessionalId(userId);
    const block = ScheduleBlock.create({ ...input, professionalId }, clock());
    await blocks.insert(block);
    const overlapping = await appointments.findOverlapping({ professionalId, from: block.startsAt, to: block.endsAt });
    return { block, affected: await withReferences(overlapping.filter((appointment) => appointment.isScheduled())) };
  }

  async function deleteBlock(userId: string, id: string): Promise<void> {
    const professionalId = await currentProfessionalId(userId);
    const block = await blocks.findById(id);
    if (!block || block.professionalId !== professionalId) {
      throw new NotFoundError('Block not found');
    }
    await blocks.delete(id);
  }

  async function listFreeSlots(query: FreeSlotsQuery): Promise<Slot[]> {
    const details = await professionals.getById(query.professionalId);
    if (!details.account.active) {
      return [];
    }
    const usableUnits = activeUnitIds(details);
    const period = { from: query.from, to: query.to };
    const [availabilityList, blockList, appointmentList] = await Promise.all([
      availabilities.findByProfessional(query.professionalId, { unitId: query.unitId, modality: query.modality }),
      blocks.findOverlapping(query.professionalId, period),
      appointments.findOverlapping({ professionalId: query.professionalId, ...period }),
    ]);
    return freeSlots({
      availabilities: availabilityList.filter((availability) => usableUnits.has(availability.unitId)),
      blocks: blockList,
      appointments: appointmentList,
      ...period,
      now: clock(),
      timeZone,
    });
  }

  async function bookableProfessional(professionalId: string): Promise<ProfessionalDetails> {
    let details: ProfessionalDetails;
    try {
      details = await professionals.getById(professionalId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new DomainError('Professional does not exist');
      }
      throw error;
    }
    if (!details.account.active) {
      throw new DomainError('Professional is not accepting appointments');
    }
    return details;
  }

  async function findRequestedSlot(details: ProfessionalDetails, input: ScheduleAppointmentInput): Promise<Slot> {
    const date = toZonedDate(input.startsAt, timeZone);
    const period = { from: startOfZonedDay(date, timeZone), to: startOfZonedDay(addDays(date, 1), timeZone) };
    const usableUnits = activeUnitIds(details);
    const [availabilityList, blockList] = await Promise.all([
      availabilities.findByProfessional(details.professional.id, { unitId: input.unitId, modality: input.modality }),
      blocks.findOverlapping(details.professional.id, period),
    ]);
    const slot = candidateSlots({
      availabilities: availabilityList.filter((availability) => usableUnits.has(availability.unitId)),
      blocks: blockList,
      ...period,
      timeZone,
    }).find((candidate) => candidate.startsAt.getTime() === input.startsAt.getTime());
    if (!slot) {
      throw new DomainError('startsAt is not an available slot of the professional for this unit and modality');
    }
    return slot;
  }

  async function ensureTeleconsultationConsent(patientId: string, acceptTerms: boolean, now: Date, tx: Transaction): Promise<void> {
    if (await lgpd.hasActiveConsent(patientId, 'TELECONSULTATION', tx)) {
      return;
    }
    if (!acceptTerms) {
      throw new DomainError('The patient must accept the teleconsultation terms', { code: 'CONSENT_REQUIRED' });
    }
    await lgpd.grantConsent({ patientId, purpose: 'TELECONSULTATION', termsVersion: config.termsVersion, at: now }, tx);
  }

  async function schedule(userId: string, input: ScheduleAppointmentInput): Promise<AppointmentDetails> {
    const now = clock();
    const patientId = await currentPatientId(userId);
    const details = await bookableProfessional(input.professionalId);
    const slot = await findRequestedSlot(details, input);
    const appointment = Appointment.schedule({ patientId, professionalId: details.professional.id, ...slot }, now);
    const { startsAt: from, endsAt: to } = appointment;

    await db.transaction(async (tx) => {
      await units.getActiveById(appointment.unitId, tx);
      await appointments.lockPatientSchedule(patientId, tx);
      if ((await appointments.findOverlapping({ professionalId: appointment.professionalId, from, to }, tx)).length > 0) {
        throw new ConflictError('The slot is no longer available');
      }
      if ((await appointments.findOverlapping({ patientId, from, to }, tx)).length > 0) {
        throw new DomainError('Patient already has another appointment at this time');
      }
      if (appointment.isTeleconsultation()) {
        await ensureTeleconsultationConsent(patientId, input.acceptTeleconsultationTerms === true, now, tx);
      }
      await appointments.insert(appointment, tx);
    });

    await notify('scheduled', appointment, () => notifier.appointmentScheduled(appointment));
    return withReference(appointment);
  }

  async function list(viewer: Viewer, input: ListAppointmentsInput, pagination: Pagination) {
    const filters = { ...input };
    if (viewer.role !== 'ADMIN') {
      const participant = await participantOf(viewer);
      filters.patientId = participant.by === 'PATIENT' ? participant.patientId : undefined;
      filters.professionalId = participant.by === 'PROFESSIONAL' ? participant.professionalId : undefined;
    }
    const { items, total } = await appointments.findMany(filters, pagination);
    return { items: await withReferences(items), total };
  }

  async function getById(viewer: Viewer, id: string): Promise<AppointmentDetails> {
    const appointment = await appointments.findById(id);
    if (!appointment || (viewer.role !== 'ADMIN' && !takesPart(await participantOf(viewer), appointment))) {
      throw new NotFoundError('Appointment not found');
    }
    return withReference(appointment);
  }

  async function changeOwn(participant: Participant, id: string, change: (appointment: Appointment) => void): Promise<Appointment> {
    return db.transaction(async (tx) => {
      const appointment = await appointments.findByIdForUpdate(id, tx);
      if (!appointment || !takesPart(participant, appointment)) {
        throw new NotFoundError('Appointment not found');
      }
      change(appointment);
      await appointments.update(appointment, tx);
      return appointment;
    });
  }

  async function cancel(viewer: Viewer, id: string, reason: string): Promise<AppointmentDetails> {
    const now = clock();
    const participant = await participantOf(viewer);
    const by: CancellationActor = participant.by;
    const appointment = await changeOwn(participant, id, (appointment) => appointment.cancel(reason, by, now));
    await notify('canceled', appointment, () => notifier.appointmentCanceled(appointment));
    return withReference(appointment);
  }

  async function markNoShow(userId: string, id: string): Promise<AppointmentDetails> {
    const now = clock();
    const participant: Participant = { by: 'PROFESSIONAL', professionalId: await currentProfessionalId(userId) };
    return withReference(await changeOwn(participant, id, (appointment) => appointment.markNoShow(now)));
  }

  async function day(userId: string, date: string, unitId?: string): Promise<AppointmentDetails[]> {
    const professionalId = await currentProfessionalId(userId);
    const from = startOfZonedDay(date, timeZone);
    const to = startOfZonedDay(addDays(date, 1), timeZone);
    return withReferences(await appointments.findOverlapping({ professionalId, unitId, from, to, includeCanceled: true }));
  }

  async function findAppointmentForRecord(id: string, tx?: Transaction): Promise<Appointment> {
    const appointment = tx ? await appointments.findByIdForUpdate(id, tx) : await appointments.findById(id);
    if (!appointment) {
      throw new NotFoundError('Appointment not found');
    }
    return appointment;
  }

  async function completeAppointment(id: string, tx: Transaction): Promise<void> {
    const appointment = await findAppointmentForRecord(id, tx);
    appointment.complete();
    await appointments.update(appointment, tx);
  }

  async function hasLinkWithPatient(professionalId: string, patientId: string): Promise<boolean> {
    return appointments.existsNotCanceledBetween(professionalId, patientId);
  }

  async function listByPatient(patientId: string, filter: PatientAppointmentsFilter = {}): Promise<AppointmentDetails[]> {
    return withReferences(await appointments.findByPatient(patientId, filter));
  }

  async function cancelTeleconsultationsOnConsentRevocation(
    revocation: ConsentRevocation,
    tx: Transaction,
  ): Promise<ConsentRevocationOutcome | null> {
    if (revocation.purpose !== 'TELECONSULTATION') {
      return null;
    }
    const found = await appointments.findScheduledAfterForUpdate(
      { patientId: revocation.patientId, modality: 'TELECONSULTATION', after: revocation.at },
      tx,
    );
    if (found.length === 0) {
      return null;
    }
    for (const appointment of found) {
      appointment.cancel(consentRevokedReason, 'PATIENT', revocation.at);
      await appointments.update(appointment, tx);
    }
    return {
      effect: {
        type: 'CANCELED_TELECONSULTATIONS',
        count: found.length,
        appointments: found.map((appointment) => ({ id: appointment.id, startsAt: appointment.startsAt.toISOString() })),
      },
      afterCommit: async () => {
        for (const appointment of found) {
          await notify('canceled', appointment, () => notifier.appointmentCanceled(appointment));
        }
      },
    };
  }

  async function futureAppointmentsPendency(
    filter: Omit<FutureAppointmentsFilter, 'after'>,
    tx?: Transaction,
  ): Promise<FutureAppointmentsPendency | null> {
    const found = await appointments.findScheduledAfter({ ...filter, after: clock() }, tx);
    if (found.length === 0) {
      return null;
    }
    return {
      type: 'FUTURE_APPOINTMENTS',
      count: found.length,
      appointments: found.map((appointment) => ({ id: appointment.id, startsAt: appointment.startsAt.toISOString() })),
    };
  }

  return {
    listAvailabilities,
    createAvailability,
    updateAvailability,
    deleteAvailability,
    listBlocks,
    createBlock,
    deleteBlock,
    listFreeSlots,
    schedule,
    list,
    getById,
    cancel,
    markNoShow,
    day,
    findAppointmentForRecord,
    completeAppointment,
    hasLinkWithPatient,
    listByPatient,
    futureAppointmentsPendency,
    cancelTeleconsultationsOnConsentRevocation,
  };
}
