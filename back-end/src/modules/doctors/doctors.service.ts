import { DateTime } from "luxon";
import { Types } from "mongoose";
import { env } from "../../config/env";
import { AppointmentModel } from "../../models/Appointment";
import { DoctorModel, type IDoctorDocument } from "../../models/Doctor";
import {
  DoctorScheduleModel,
  type IDoctorScheduleDocument,
  type IUnavailableBlock,
} from "../../models/DoctorSchedule";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";

interface CreateDoctorInput {
  actor: AuthUser;
  userId?: string;
  fullName: string;
  specialty: string;
  licenseNumber?: string;
  isActive?: boolean;
}

interface ListDoctorsInput {
  specialty?: string;
  isActive?: boolean;
  limit: number;
}

interface UpsertDoctorScheduleInput {
  actor: AuthUser;
  doctorId: string;
  timezone?: string;
  slotStepMinutes?: number;
  weeklyAvailability: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }>;
  unavailableBlocks?: Array<{
    startAt: Date;
    endAt: Date;
    reason?: string;
  }>;
}

interface ListDoctorSlotsInput {
  actor: AuthUser;
  doctorId: string;
  date: string;
  days: number;
  estimatedDurationMinutes: number;
}

export interface AvailableSlot {
  startAtUtc: string;
  endAtUtc: string;
  startAtLocal: string;
  endAtLocal: string;
  timezone: string;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(":");
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

function overlapExists(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

function validateWeeklyAvailability(
  weeklyAvailability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>,
): void {
  weeklyAvailability.forEach((slot) => {
    const start = parseTime(slot.startTime);
    const end = parseTime(slot.endTime);

    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    if (endMinutes <= startMinutes) {
      throw new ApiError(400, "weeklyAvailability endTime must be after startTime");
    }
  });
}

async function ensureDoctorCanEditSchedule(actor: AuthUser, doctorId: string): Promise<void> {
  if (actor.role === "admin") {
    return;
  }

  if (actor.role !== "doctor") {
    throw new ApiError(403, "Only admin or the doctor owner can update schedules");
  }

  const doctor = await DoctorModel.findById(doctorId).select("userId");
  if (!doctor) {
    throw new ApiError(404, "Doctor not found");
  }

  if (!doctor.userId || doctor.userId.toString() !== actor.id) {
    throw new ApiError(403, "You can only update your own doctor schedule");
  }
}

function isBlockedByExceptions(
  unavailableBlocks: IUnavailableBlock[],
  slotStart: Date,
  slotEnd: Date,
): boolean {
  return unavailableBlocks.some((block) => overlapExists(slotStart, slotEnd, block.startAt, block.endAt));
}

export const doctorsService = {
  async create(input: CreateDoctorInput): Promise<IDoctorDocument> {
    const doctor = await DoctorModel.create({
      userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
      fullName: input.fullName,
      specialty: input.specialty,
      licenseNumber: input.licenseNumber,
      isActive: input.isActive ?? true,
      createdBy: new Types.ObjectId(input.actor.id),
    });

    return doctor;
  },

  async list(input: ListDoctorsInput): Promise<IDoctorDocument[]> {
    const query: Record<string, unknown> = {};
    if (input.specialty) {
      query.specialty = new RegExp(input.specialty, "i");
    }
    if (input.isActive !== undefined) {
      query.isActive = input.isActive;
    }

    return DoctorModel.find(query).sort({ fullName: 1 }).limit(input.limit);
  },

  async getById(doctorId: string): Promise<IDoctorDocument> {
    const doctor = await DoctorModel.findById(doctorId);
    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }
    return doctor;
  },

  async upsertSchedule(input: UpsertDoctorScheduleInput): Promise<IDoctorScheduleDocument> {
    await ensureDoctorCanEditSchedule(input.actor, input.doctorId);

    const doctor = await DoctorModel.findById(input.doctorId).select("_id");
    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    validateWeeklyAvailability(input.weeklyAvailability);
    const timezone = input.timezone ?? env.APP_TIMEZONE;

    const schedule = await DoctorScheduleModel.findOneAndUpdate(
      { doctorId: doctor._id },
      {
        $set: {
          timezone,
          slotStepMinutes: input.slotStepMinutes ?? 15,
          weeklyAvailability: input.weeklyAvailability,
          unavailableBlocks: input.unavailableBlocks ?? [],
          updatedBy: new Types.ObjectId(input.actor.id),
        },
        $setOnInsert: {
          createdBy: new Types.ObjectId(input.actor.id),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    if (!schedule) {
      throw new ApiError(500, "Failed to create doctor schedule");
    }

    return schedule;
  },

  async getSchedule(doctorId: string): Promise<IDoctorScheduleDocument> {
    const schedule = await DoctorScheduleModel.findOne({ doctorId: new Types.ObjectId(doctorId) });
    if (!schedule) {
      throw new ApiError(404, "Doctor schedule not found");
    }
    return schedule;
  },

  async getAvailableSlots(input: ListDoctorSlotsInput): Promise<AvailableSlot[]> {
    const doctor = await DoctorModel.findById(input.doctorId);
    if (!doctor || !doctor.isActive) {
      throw new ApiError(404, "Doctor not found or inactive");
    }

    const schedule = await DoctorScheduleModel.findOne({ doctorId: doctor._id });
    if (!schedule || schedule.weeklyAvailability.length === 0) {
      return [];
    }

    const tz = schedule.timezone || env.APP_TIMEZONE;
    const fromLocal = DateTime.fromISO(input.date, { zone: tz }).startOf("day");
    if (!fromLocal.isValid) {
      throw new ApiError(400, "Invalid date for slots");
    }

    const endLocal = fromLocal.plus({ days: input.days - 1 }).endOf("day");
    const fromUtc = fromLocal.toUTC().toJSDate();
    const endUtc = endLocal.toUTC().toJSDate();

    const bookedAppointments = await AppointmentModel.find({
      doctorId: doctor._id,
      deletedAt: { $exists: false },
      status: { $nin: ["cancelled"] },
      startAt: { $lt: endUtc },
      endAt: { $gt: fromUtc },
    }).select("startAt endAt");

    const slots: AvailableSlot[] = [];
    for (let dayOffset = 0; dayOffset < input.days; dayOffset += 1) {
      const dayLocal = fromLocal.plus({ days: dayOffset });
      const dayOfWeek = dayLocal.weekday % 7;
      const dayTemplates = schedule.weeklyAvailability.filter((item) => item.dayOfWeek === dayOfWeek);

      for (const template of dayTemplates) {
        const start = parseTime(template.startTime);
        const end = parseTime(template.endTime);

        const blockStart = dayLocal.set({
          hour: start.hour,
          minute: start.minute,
          second: 0,
          millisecond: 0,
        });
        const blockEnd = dayLocal.set({
          hour: end.hour,
          minute: end.minute,
          second: 0,
          millisecond: 0,
        });

        let cursor = blockStart;
        while (cursor.plus({ minutes: input.estimatedDurationMinutes }) <= blockEnd) {
          const slotStart = cursor;
          const slotEnd = cursor.plus({ minutes: input.estimatedDurationMinutes });
          const slotStartDate = slotStart.toUTC().toJSDate();
          const slotEndDate = slotEnd.toUTC().toJSDate();

          const blockedByException = isBlockedByExceptions(
            schedule.unavailableBlocks,
            slotStartDate,
            slotEndDate,
          );
          if (blockedByException) {
            cursor = cursor.plus({ minutes: schedule.slotStepMinutes });
            continue;
          }

          const overlapsBooked = bookedAppointments.some((appointment) => {
            return overlapExists(slotStartDate, slotEndDate, appointment.startAt, appointment.endAt);
          });

          if (!overlapsBooked) {
            slots.push({
              startAtUtc: slotStart.toUTC().toISO() ?? slotStartDate.toISOString(),
              endAtUtc: slotEnd.toUTC().toISO() ?? slotEndDate.toISOString(),
              startAtLocal: slotStart.toISO() ?? slotStartDate.toISOString(),
              endAtLocal: slotEnd.toISO() ?? slotEndDate.toISOString(),
              timezone: tz,
            });
          }

          cursor = cursor.plus({ minutes: schedule.slotStepMinutes });
        }
      }
    }

    return slots;
  },
};