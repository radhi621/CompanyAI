import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");
const roleSchema = z.enum(["admin", "doctor", "nurse", "secretary"]);

export const listUsersSchema = z.object({
  query: z.object({
    role: roleSchema.optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    search: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().positive().max(200).default(100),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    userId: objectIdSchema,
  }),
  body: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      role: roleSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required for update",
    }),
});

export const resetPasswordSchema = z.object({
  params: z.object({
    userId: objectIdSchema,
  }),
  body: z.object({
    newPassword: z.string().min(8).max(128),
  }),
});
