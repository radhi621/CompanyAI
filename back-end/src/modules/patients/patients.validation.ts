import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

export const createPatientSchema = z.object({
  body: z.object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    cin: z.string().min(4).max(20),
    phone: z.string().min(5).max(30).optional(),
    email: z.string().email().optional(),
    dateOfBirth: z.coerce.date().optional(),
    pathologies: z.array(z.string().min(2).max(100)).optional(),
    assignedStaff: z.array(objectIdSchema).optional(),
  }),
});

export const listPatientsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const patientIdSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
});

export const updatePatientSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
  body: z
    .object({
      firstName: z.string().trim().min(2).max(80).optional(),
      lastName: z.string().trim().min(2).max(80).optional(),
      phone: z.string().min(5).max(30).optional(),
      email: z.string().email().optional(),
      dateOfBirth: z.coerce.date().optional(),
      // Added to the existing list (duplicates ignored, case-insensitive).
      pathologies: z.array(z.string().min(2).max(100)).optional(),
      // Removed from the existing list (case-insensitive).
      removePathologies: z.array(z.string().min(1).max(100)).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required for update",
    }),
});

export const listPatientNotesSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const createPatientNoteSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
  body: z.object({
    content: z.string().trim().min(3).max(4000),
  }),
});

export const updatePatientNoteSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
    noteId: objectIdSchema,
  }),
  body: z.object({
    content: z.string().trim().min(3).max(4000),
  }),
});

export const patientNoteIdSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
    noteId: objectIdSchema,
  }),
});

export const updateAssignmentsSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
  body: z.object({
    assignedStaff: z.array(objectIdSchema).min(1),
  }),
});