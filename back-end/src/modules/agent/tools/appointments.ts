// Appointment and schedule tools.
import { DateTime } from "luxon";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../../config/env";
import { AppointmentModel } from "../../../models/Appointment";
import { ApiError } from "../../../utils/apiError";
import { appointmentsService } from "../../appointments/appointments.service";
import { doctorsService, getDoctorTimezone } from "../../doctors/doctors.service";
import { defineTool, objectIdSchema, localDateSchema, localTimeSchema, parseLocalDateTime, getAccessiblePatientIds } from "./shared";

export const appointmentsTools = {
  list_appointments: defineTool({
    description: "Lists appointments by optional patient/doctor/date filters",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "optional MongoDB ObjectId",
      doctorId: "optional MongoDB ObjectId",
      date: "optional YYYY-MM-DD",
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      patientId: objectIdSchema.optional(),
      doctorId: objectIdSchema.optional(),
      date: localDateSchema.optional(),
      limit: z.coerce.number().int().positive().max(100).default(30),
    }),
    run: async (args, context) => {
      let from: Date | undefined;
      let to: Date | undefined;

      if (args.date) {
        const start = DateTime.fromISO(args.date, { zone: env.APP_TIMEZONE }).startOf("day");
        from = start.toUTC().toJSDate();
        to = start.endOf("day").toUTC().toJSDate();
      }

      return appointmentsService.list({
        actor: context.actor,
        patientId: args.patientId,
        doctorId: args.doctorId,
        from,
        to,
        limit: args.limit,
      });
    },
  }),
  check_availability: defineTool({
    description: "Checks whether a doctor is available at a given local date/time",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      doctorId: "required MongoDB ObjectId",
      date: "required YYYY-MM-DD",
      time: "required HH:mm",
      estimatedDurationMinutes: "optional number",
    },
    argsSchema: z.object({
      doctorId: objectIdSchema,
      date: localDateSchema,
      time: localTimeSchema,
      estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
    }),
    run: async (args, context) => {
      // Times are the doctor's local time, matching how their slots are generated.
      const timezone = await getDoctorTimezone(args.doctorId);
      const requested = parseLocalDateTime(args.date, args.time, timezone);

      const duration = args.estimatedDurationMinutes ?? env.DEFAULT_APPOINTMENT_DURATION_MINUTES;
      const slots = await doctorsService.getAvailableSlots({
        actor: context.actor,
        doctorId: args.doctorId,
        date: args.date,
        days: 1,
        estimatedDurationMinutes: duration,
      });

      const requestedMinute = Math.floor(requested.toUTC().toMillis() / 60000);
      const isAvailable = slots.some((slot) => {
        const slotMinute = Math.floor(DateTime.fromISO(slot.startAtUtc).toUTC().toMillis() / 60000);
        return slotMinute === requestedMinute;
      });

      return {
        doctorId: args.doctorId,
        requestedStartAtLocal: requested.toISO(),
        requestedStartAtUtc: requested.toUTC().toISO(),
        timezone,
        estimatedDurationMinutes: duration,
        isAvailable,
        suggestedSlots: slots.slice(0, 5),
      };
    },
  }),
  create_appointment: defineTool({
    description: "Creates an appointment from local date/time and reason",
    allowedRoles: ["admin", "doctor", "secretary"],
    destructive: true,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      doctorId: "required MongoDB ObjectId",
      date: "required YYYY-MM-DD",
      time: "required HH:mm",
      motif: "required string",
      estimatedDurationMinutes: "optional number",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      doctorId: objectIdSchema,
      date: localDateSchema,
      time: localTimeSchema,
      motif: z.string().min(3).max(600),
      estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
    }),
    run: async (args, context) => {
      const localStart = parseLocalDateTime(args.date, args.time, await getDoctorTimezone(args.doctorId));
      const appointment = await appointmentsService.create({
        actor: context.actor,
        patientId: args.patientId,
        doctorId: args.doctorId,
        startAt: localStart.toUTC().toJSDate(),
        estimatedDurationMinutes: args.estimatedDurationMinutes,
        reason: args.motif,
        source: "ai",
      });

      return {
        appointmentId: appointment._id.toString(),
        status: appointment.status,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      };
    },
  }),
  cancel_appointment: defineTool({
    description: "Cancels an appointment by setting status to cancelled",
    allowedRoles: ["admin", "doctor", "secretary"],
    destructive: true,
    argsShape: {
      appointmentId: "required MongoDB ObjectId",
      reason: "optional string",
    },
    argsSchema: z.object({
      appointmentId: objectIdSchema,
      reason: z.string().max(600).optional(),
    }),
    run: async (args, context) => {
      // Keep existing notes and append the cancellation reason instead of replacing them.
      const existing = await appointmentsService.getById(args.appointmentId, context.actor);
      const reason = args.reason?.trim();
      const notes = reason
        ? [existing.notes?.trim(), `Cancellation reason: ${reason}`].filter(Boolean).join("\n")
        : undefined;

      const appointment = await appointmentsService.update({
        actor: context.actor,
        appointmentId: args.appointmentId,
        status: "cancelled",
        notes,
      });

      return {
        appointmentId: appointment._id.toString(),
        status: appointment.status,
      };
    },
  }),
  get_day_schedule: defineTool({
    description: "Returns the schedule for a day, optionally filtered by doctor",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      date: "required YYYY-MM-DD",
      doctorId: "optional MongoDB ObjectId",
    },
    argsSchema: z.object({
      date: localDateSchema,
      doctorId: objectIdSchema.optional(),
    }),
    run: async (args, context) => {
      const localStart = DateTime.fromISO(args.date, { zone: env.APP_TIMEZONE }).startOf("day");
      if (!localStart.isValid) {
        throw new ApiError(400, "Invalid date");
      }

      const dayStart = localStart.toUTC().toJSDate();
      const dayEnd = localStart.endOf("day").toUTC().toJSDate();

      const query: Record<string, unknown> = {
        deletedAt: { $exists: false },
        startAt: {
          $gte: dayStart,
          $lte: dayEnd,
        },
      };

      if (args.doctorId) {
        query.doctorId = new Types.ObjectId(args.doctorId);
      }

      const accessiblePatientIds = await getAccessiblePatientIds(context.actor);
      if (accessiblePatientIds) {
        if (accessiblePatientIds.length === 0) {
          return {
            date: args.date,
            timezone: env.APP_TIMEZONE,
            appointments: [],
          };
        }

        query.patientId = {
          $in: accessiblePatientIds,
        };
      }

      const appointments = await AppointmentModel.find(query)
        .sort({ startAt: 1 })
        .populate("patientId", "firstName lastName cin")
        .populate("doctorId", "fullName specialty");

      return {
        date: args.date,
        timezone: env.APP_TIMEZONE,
        appointments,
      };
    },
  }),
};
