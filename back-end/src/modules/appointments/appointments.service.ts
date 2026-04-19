import { Types } from "mongoose";
import { env } from "../../config/env";
import { isHigherRole } from "../../constants/roles";
import {
  AppointmentModel,
  type AppointmentStatus,
  type IAppointmentDocument,
} from "../../models/Appointment";
import { DoctorModel } from "../../models/Doctor";
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

async function assertNoConflict(
  doctorId: string,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: string,
): Promise<void> {
  const conflict = await AppointmentModel.findOne({
    doctorId: new Types.ObjectId(doctorId),
    deletedAt: { $exists: false },
    status: { $nin: ["cancelled"] },
    ...(excludeAppointmentId
      ? {
          _id: { $ne: new Types.ObjectId(excludeAppointmentId) },
        }
      : {}),
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }).select("_id startAt endAt");

  if (conflict) {
    throw new ApiError(409, "This doctor already has an overlapping appointment in that time range");
  }
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

    await assertNoConflict(input.doctorId, timing.startAt, timing.endAt);

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

    const nextStartAt = input.startAt ?? appointment.startAt;
    const nextEndAt = input.endAt;
    const nextEstimated = input.estimatedDurationMinutes ?? appointment.estimatedDurationMinutes;

    const timing = resolveTimeRange({
      actorRole: input.actor.role,
      startAt: nextStartAt,
      endAt: nextEndAt,
      estimatedDurationMinutes: nextEstimated,
    });

    await assertNoConflict(
      appointment.doctorId.toString(),
      timing.startAt,
      timing.endAt,
      appointment._id.toString(),
    );

    appointment.startAt = timing.startAt;
    appointment.endAt = timing.endAt;
    appointment.estimatedDurationMinutes = timing.estimatedDurationMinutes;

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

    await assertNoConflict(
      appointment.doctorId.toString(),
      appointment.startAt,
      appointment.endAt,
      appointment._id.toString(),
    );

    appointment.deletedAt = undefined;
    appointment.deletedBy = undefined;
    appointment.updatedBy = new Types.ObjectId(actor.id);
    await appointment.save();
    return appointment;
  },
};