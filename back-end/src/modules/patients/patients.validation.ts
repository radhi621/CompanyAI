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

export const updateAssignmentsSchema = z.object({
  params: z.object({
    patientId: objectIdSchema,
  }),
  body: z.object({
    assignedStaff: z.array(objectIdSchema).min(1),
  }),
});