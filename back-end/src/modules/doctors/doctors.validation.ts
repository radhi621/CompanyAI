import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");
const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

const weeklyAvailabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(hhmmPattern, "Invalid startTime format (HH:mm expected)"),
  endTime: z.string().regex(hhmmPattern, "Invalid endTime format (HH:mm expected)"),
});

const unavailableBlockSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  reason: z.string().max(300).optional(),
});

export const createDoctorSchema = z.object({
  body: z.object({
    userId: objectIdSchema.optional(),
    fullName: z.string().min(3).max(120),
    specialty: z.string().min(2).max(80),
    licenseNumber: z.string().min(3).max(60).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const listDoctorSchema = z.object({
  query: z.object({
    specialty: z.string().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const doctorIdSchema = z.object({
  params: z.object({
    doctorId: objectIdSchema,
  }),
});

export const upsertDoctorScheduleSchema = z.object({
  params: z.object({
    doctorId: objectIdSchema,
  }),
  body: z.object({
    timezone: z.string().optional(),
    slotStepMinutes: z.number().int().min(5).max(120).optional(),
    weeklyAvailability: z.array(weeklyAvailabilitySchema).min(1),
    unavailableBlocks: z.array(unavailableBlockSchema).optional(),
  }),
});

export const listDoctorSlotsSchema = z.object({
  params: z.object({
    doctorId: objectIdSchema,
  }),
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    days: z.coerce.number().int().positive().max(30).default(1),
    estimatedDurationMinutes: z.coerce.number().int().positive().max(720).default(45),
  }),
});