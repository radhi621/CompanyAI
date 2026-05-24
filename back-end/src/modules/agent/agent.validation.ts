import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const conversationTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  text: z.string().max(8000),
});

export const executeAgentSchema = z.object({
  body: z.object({
    prompt: z.string().min(5).max(8000),
    maxToolCalls: z.coerce.number().int().min(1).max(5).default(3),
    history: z.array(conversationTurnSchema).max(100).optional(),
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

export const listAgentHistorySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(40),
    includeFailures: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    actorId: objectIdSchema.optional(),
  }),
});