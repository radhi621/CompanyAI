import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

export const executeAgentSchema = z.object({
  body: z.object({
    prompt: z.string().trim().min(1).max(8000),
    // The frontend's chat session ID: messages with the same ID share one conversation.
    conversationId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Invalid conversation ID"),
    // The patient folder the chat belongs to, if any.
    patientId: objectIdSchema.optional(),
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