import type { Appointment } from '../entities/appointment.entity';

export interface AppointmentNotifier {
  appointmentScheduled(appointment: Appointment): Promise<void>;
  appointmentCanceled(appointment: Appointment): Promise<void>;
}

export function createNoopAppointmentNotifier(): AppointmentNotifier {
  return {
    async appointmentScheduled() {},
    async appointmentCanceled() {},
  };
}
