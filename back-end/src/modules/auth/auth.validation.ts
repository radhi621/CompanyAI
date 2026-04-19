import { z } from "zod";

const roleSchema = z.enum(["admin", "doctor", "nurse", "secretary"]);

export const bootstrapAdminSchema = z.object({
  body: z.object({
    bootstrapKey: z.string().min(8),
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
  }),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: roleSchema.default("secretary"),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1).optional(),
  }),
});

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1).optional(),
  }),
});