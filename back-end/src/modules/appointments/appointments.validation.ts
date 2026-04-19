import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const appointmentStatusSchema = z.enum([
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

export const createAppointmentSchema = z.object({
  body: z.object({
    patientId: objectIdSchema,
    doctorId: objectIdSchema,
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
    reason: z.string().min(3).max(600),
    status: appointmentStatusSchema.optional(),
    source: z.enum(["manual", "ai"]).optional(),
    notes: z.string().max(3000).optional(),
  }),
});

export const listAppointmentsSchema = z.object({
  query: z.object({
    patientId: objectIdSchema.optional(),
    doctorId: objectIdSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    status: appointmentStatusSchema.optional(),
    includeDeleted: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().positive().max(200).default(50),
  }),
});

export const appointmentIdSchema = z.object({
  params: z.object({
    appointmentId: objectIdSchema,
  }),
});

export const updateAppointmentSchema = z.object({
  params: z.object({
    appointmentId: objectIdSchema,
  }),
  body: z
    .object({
      startAt: z.coerce.date().optional(),
      endAt: z.coerce.date().optional(),
      estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
      reason: z.string().min(3).max(600).optional(),
      status: appointmentStatusSchema.optional(),
      notes: z.string().max(3000).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required for update",
    }),
});