import { Types } from "mongoose";
import { env } from "../../config/env";
import { isHigherRole } from "../../constants/roles";
import {
  AppointmentModel,
  type AppointmentStatus,
  type IAppointmentDocument,
} from "../../models/Appointment";
import { DoctorModel } from "../../models/Doctor";
import { assertWithinDoctorSchedule } from "../doctors/doctors.service";
import { PatientModel } from "../../models/Patient";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";

const DEFAULT_DURATION_MINUTES = env.DEFAULT_APPOINTMENT_DURATION_MINUTES;
const MAX_DURATION_MINUTES = env.MAX_APPOINTMENT_DURATION_MINUTES;
const OVERRIDE_ROLES = new Set(["admin", "doctor", "secretary"]);

interface CreateAppointmentInput {
  actor: AuthUser;
  patientId: string;
  doctorId: string;
  startAt: Date;
  endAt?: Date;
  estimatedDurationMinutes?: number;
  reason: string;
  status?: AppointmentStatus;
  source?: "manual" | "ai";
  notes?: string;
  allowOutsideSchedule?: boolean;
}

interface ListAppointmentsInput {
  actor: AuthUser;
  patientId?: string;
  doctorId?: string;
  from?: Date;
  to?: Date;
  status?: AppointmentStatus;
  includeDeleted?: boolean;
  limit: number;
}

interface UpdateAppointmentInput {
  actor: AuthUser;
  appointmentId: string;
  startAt?: Date;
  endAt?: Date;
  estimatedDurationMinutes?: number;
  reason?: string;
  status?: AppointmentStatus;
  notes?: string;
  allowOutsideSchedule?: boolean;
}

interface ResolveTimeRangeInput {
  actorRole: AuthUser["role"];
  startAt: Date;
  endAt?: Date;
  estimatedDurationMinutes?: number;
}

function validateDate(value: Date, fieldName: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ApiError(400, `${fieldName} is invalid`);
  }
}

function canEditByOwnership(actor: AuthUser, appointment: IAppointmentDocument): boolean {
  if (actor.role === "admin") {
    return true;
  }

  const isOwner = appointment.createdBy.toString() === actor.id;
  if (isOwner) {
    return true;
  }

  return isHigherRole(actor.role, appointment.createdByRole);
}

async function assertPatientAccess(patientId: string, actor: AuthUser): Promise<void> {
  const patient = await PatientModel.findById(patientId).select("assignedStaff");
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }

  if (actor.role === "admin") {
    return;
  }

  const isAssigned = patient.assignedStaff.some((staffId) => staffId.toString() === actor.id);
  if (!isAssigned) {
    throw new ApiError(403, "You are not assigned to this patient");
  }
}

async function assertDoctorExists(doctorId: string): Promise<void> {
  const doctor = await DoctorModel.findById(doctorId).select("_id isActive");
  if (!doctor || !doctor.isActive) {
    throw new ApiError(404, "Doctor not found or inactive");
  }
}

function resolveTimeRange(input: ResolveTimeRangeInput): {
  startAt: Date;
  endAt: Date;
  estimatedDurationMinutes: number;
} {
  validateDate(input.startAt, "startAt");

  if (
    input.estimatedDurationMinutes !== undefined &&
    !OVERRIDE_ROLES.has(input.actorRole) &&
    input.estimatedDurationMinutes !== DEFAULT_DURATION_MINUTES
  ) {
    throw new ApiError(403, "Your role cannot override default appointment duration");
  }

  if (input.endAt) {
    validateDate(input.endAt, "endAt");
    if (input.endAt <= input.startAt) {
      throw new ApiError(400, "endAt must be later than startAt");
    }

    const duration = Math.ceil((input.endAt.getTime() - input.startAt.getTime()) / 60000);
    if (duration > MAX_DURATION_MINUTES) {
      throw new ApiError(400, `Appointment duration exceeds ${MAX_DURATION_MINUTES} minutes`);
    }

    return {
      startAt: input.startAt,
      endAt: input.endAt,
      estimatedDurationMinutes: duration,
    };
  }

  const duration = input.estimatedDurationMinutes ?? DEFAULT_DURATION_MINUTES;
  if (duration > MAX_DURATION_MINUTES) {
    throw new ApiError(400, `Appointment duration exceeds ${MAX_DURATION_MINUTES} minutes`);
  }

  return {
    startAt: input.startAt,
    endAt: new Date(input.startAt.getTime() + duration * 60000),
    estimatedDurationMinutes: duration,
  };
}

// Neither the doctor nor the patient can be in two active appointments at once.
async function assertNoConflict(input: {
  doctorId: string;
  patientId: string;
  startAt: Date;
  endAt: Date;
  excludeAppointmentId?: string;
}): Promise<void> {
  const overlapping = {
    deletedAt: { $exists: false },
    status: { $nin: ["cancelled"] as AppointmentStatus[] },
    ...(input.excludeAppointmentId
      ? {
          _id: { $ne: new Types.ObjectId(input.excludeAppointmentId) },
        }
      : {}),
    startAt: { $lt: input.endAt },
    endAt: { $gt: input.startAt },
  };

  if (await AppointmentModel.exists({ ...overlapping, doctorId: new Types.ObjectId(input.doctorId) })) {
    throw new ApiError(409, "This doctor already has an overlapping appointment in that time range");
  }

  if (await AppointmentModel.exists({ ...overlapping, patientId: new Types.ObjectId(input.patientId) })) {
    throw new ApiError(409, "This patient already has an overlapping appointment in that time range");
  }
}

// Small allowance so a booking made "now" is not rejected by clock drift or form latency.
const PAST_BOOKING_GRACE_MS = 5 * 60 * 1000;

function assertNotInPast(startAt: Date): void {
  if (startAt.getTime() < Date.now() - PAST_BOOKING_GRACE_MS) {
    throw new ApiError(400, "Appointments cannot be scheduled in the past");
  }
}

// Admins may book outside a doctor's working hours (e.g. emergencies); nobody else can.
function shouldBypassSchedule(actor: AuthUser, allowOutsideSchedule?: boolean): boolean {
  if (!allowOutsideSchedule) {
    return false;
  }

  if (actor.role !== "admin") {
    throw new ApiError(403, "Only admins can book outside a doctor's working hours");
  }

  return true;
}

async function getAppointmentOrThrow(appointmentId: string): Promise<IAppointmentDocument> {
  const appointment = await AppointmentModel.findById(appointmentId);
  if (!appointment || appointment.deletedAt) {
    throw new ApiError(404, "Appointment not found");
  }
  return appointment;
}

export const appointmentsService = {
  async create(input: CreateAppointmentInput): Promise<IAppointmentDocument> {
    await assertPatientAccess(input.patientId, input.actor);
    await assertDoctorExists(input.doctorId);

    const timing = resolveTimeRange({
      actorRole: input.actor.role,
      startAt: input.startAt,
      endAt: input.endAt,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
    });

    assertNotInPast(timing.startAt);
    if (!shouldBypassSchedule(input.actor, input.allowOutsideSchedule)) {
      await assertWithinDoctorSchedule(input.doctorId, timing.startAt, timing.endAt);
    }
    await assertNoConflict({
      doctorId: input.doctorId,
      patientId: input.patientId,
      startAt: timing.startAt,
      endAt: timing.endAt,
    });

    return AppointmentModel.create({
      patientId: new Types.ObjectId(input.patientId),
      doctorId: new Types.ObjectId(input.doctorId),
      startAt: timing.startAt,
      endAt: timing.endAt,
      estimatedDurationMinutes: timing.estimatedDurationMinutes,
      reason: input.reason,
      status: input.status ?? "planned",
      source: input.source ?? "manual",
      notes: input.notes,
      createdBy: new Types.ObjectId(input.actor.id),
      createdByRole: input.actor.role,
    });
  },

  async list(input: ListAppointmentsInput): Promise<IAppointmentDocument[]> {
    const query: Record<string, unknown> = {};

    if (input.patientId) {
      await assertPatientAccess(input.patientId, input.actor);
      query.patientId = new Types.ObjectId(input.patientId);
    }

    if (input.doctorId) {
      query.doctorId = new Types.ObjectId(input.doctorId);
    }

    if (input.from || input.to) {
      query.startAt = {
        ...(input.from ? { $gte: input.from } : {}),
        ...(input.to ? { $lte: input.to } : {}),
      };
    }

    if (input.status) {
      query.status = input.status;
    }

    if (input.includeDeleted) {
      if (input.actor.role !== "admin") {
        throw new ApiError(403, "Only admin can include deleted appointments");
      }
    } else {
      query.deletedAt = { $exists: false };
    }

    if (input.actor.role !== "admin") {
      const assignedPatients = await PatientModel.find({
        assignedStaff: new Types.ObjectId(input.actor.id),
      }).select("_id");
      const patientIds = assignedPatients.map((item) => item._id);

      if (patientIds.length === 0) {
        return [];
      }

      if (query.patientId) {
        const selectedPatientId = query.patientId as Types.ObjectId;
        const allowed = patientIds.some((patientId) => patientId.equals(selectedPatientId));
        if (!allowed) {
          return [];
        }
      } else {
        query.patientId = {
          $in: patientIds,
        };
      }
    }

    return AppointmentModel.find(query)
      .sort({ startAt: 1 })
      .limit(input.limit)
      .populate("patientId", "firstName lastName cin")
      .populate("doctorId", "fullName specialty")
      .populate("createdBy", "name role");
  },

  async getById(appointmentId: string, actor: AuthUser): Promise<IAppointmentDocument> {
    const appointment = await getAppointmentOrThrow(appointmentId);
    await assertPatientAccess(appointment.patientId.toString(), actor);
    return appointment;
  },

  async update(input: UpdateAppointmentInput): Promise<IAppointmentDocument> {
    const appointment = await getAppointmentOrThrow(input.appointmentId);
    await assertPatientAccess(appointment.patientId.toString(), input.actor);

    if (!canEditByOwnership(input.actor, appointment)) {
      throw new ApiError(403, "Only owner or higher role can modify this appointment");
    }

    const timingChanged =
      input.startAt !== undefined ||
      input.endAt !== undefined ||
      input.estimatedDurationMinutes !== undefined;
    const nextStatus = input.status ?? appointment.status;
    const reactivating = appointment.status === "cancelled" && nextStatus !== "cancelled";

    // Status, reason or notes changes (e.g. cancelling, or marking a past visit completed)
    // must not be blocked by time checks; only re-validate when the slot itself changes
    // or a cancelled appointment is reinstated.
    if (timingChanged) {
      const timing = resolveTimeRange({
        actorRole: input.actor.role,
        startAt: input.startAt ?? appointment.startAt,
        endAt: input.endAt,
        estimatedDurationMinutes: input.estimatedDurationMinutes ?? appointment.estimatedDurationMinutes,
      });

      assertNotInPast(timing.startAt);
      if (!shouldBypassSchedule(input.actor, input.allowOutsideSchedule)) {
        await assertWithinDoctorSchedule(appointment.doctorId.toString(), timing.startAt, timing.endAt);
      }

      appointment.startAt = timing.startAt;
      appointment.endAt = timing.endAt;
      appointment.estimatedDurationMinutes = timing.estimatedDurationMinutes;
    }

    if (nextStatus !== "cancelled" && (timingChanged || reactivating)) {
      await assertNoConflict({
        doctorId: appointment.doctorId.toString(),
        patientId: appointment.patientId.toString(),
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        excludeAppointmentId: appointment._id.toString(),
      });
    }

    if (input.reason !== undefined) {
      appointment.reason = input.reason;
    }

    if (input.status !== undefined) {
      appointment.status = input.status;
    }

    if (input.notes !== undefined) {
      appointment.notes = input.notes;
    }

    appointment.updatedBy = new Types.ObjectId(input.actor.id);
    await appointment.save();
    return appointment;
  },

  async softDelete(appointmentId: string, actor: AuthUser): Promise<void> {
    const appointment = await getAppointmentOrThrow(appointmentId);
    await assertPatientAccess(appointment.patientId.toString(), actor);

    if (!canEditByOwnership(actor, appointment)) {
      throw new ApiError(403, "Only owner or higher role can delete this appointment");
    }

    appointment.deletedAt = new Date();
    appointment.deletedBy = new Types.ObjectId(actor.id);
    appointment.updatedBy = new Types.ObjectId(actor.id);
    await appointment.save();
  },

  async restore(appointmentId: string, actor: AuthUser): Promise<IAppointmentDocument> {
    if (actor.role !== "admin") {
      throw new ApiError(403, "Only admin can restore soft deleted appointments");
    }

    const appointment = await AppointmentModel.findById(appointmentId);
    if (!appointment || !appointment.deletedAt) {
      throw new ApiError(404, "Deleted appointment not found");
    }

    if (appointment.status !== "cancelled") {
      await assertNoConflict({
        doctorId: appointment.doctorId.toString(),
        patientId: appointment.patientId.toString(),
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        excludeAppointmentId: appointment._id.toString(),
      });
    }

    appointment.deletedAt = undefined;
    appointment.deletedBy = undefined;
    appointment.updatedBy = new Types.ObjectId(actor.id);
    await appointment.save();
    return appointment;
  },
};