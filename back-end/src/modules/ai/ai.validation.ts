import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");
const modeSchema = z.enum(["non_rag", "rag"]);

const optionalTrimmedString = (min: number, max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().min(min).max(max).optional());

export const generateAIRecordSchema = z.object({
  body: z.object({
    patientId: objectIdSchema,
    title: z.string().max(120).optional(),
    prompt: z.string().min(5).max(8000),
    mode: modeSchema.default("non_rag"),
  }),
});

export const uploadAIRecordSchema = z.object({
  body: z.object({
    patientId: objectIdSchema,
    title: optionalTrimmedString(1, 120),
    prompt: optionalTrimmedString(5, 8000),
    mode: modeSchema.default("non_rag"),
  }),
});

export const listAIRecordSchema = z.object({
  query: z.object({
    patientId: objectIdSchema.optional(),
    mode: modeSchema.optional(),
    includeDeleted: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const aiRecordIdSchema = z.object({
  params: z.object({
    recordId: objectIdSchema,
  }),
});

export const updateAIRecordSchema = z.object({
  params: z.object({
    recordId: objectIdSchema,
  }),
  body: z
    .object({
      title: z.string().max(120).optional(),
      response: z.string().min(5).max(12000).optional(),
    })
    .refine((body) => body.title !== undefined || body.response !== undefined, {
      message: "At least one field must be provided for update",
    }),
});

export const restoreAIRecordSchema = z.object({
  params: z.object({
    recordId: objectIdSchema,
  }),
});