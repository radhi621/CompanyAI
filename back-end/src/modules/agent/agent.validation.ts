import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

export const executeAgentSchema = z.object({
  body: z.object({
    prompt: z.string().min(5).max(8000),
    maxToolCalls: z.coerce.number().int().min(1).max(5).default(3),
  }),
});

export const confirmPendingActionSchema = z.object({
  params: z.object({
    actionId: objectIdSchema,
  }),
  body: z.object({
    approved: z.boolean(),
  }),
});