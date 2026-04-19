import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { agentService } from "./agent.service";
import { confirmPendingActionSchema, executeAgentSchema } from "./agent.validation";

export const agentController = {
  execute: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = executeAgentSchema.parse({ body: req.body });
    const idempotencyKey = req.header("Idempotency-Key") ?? undefined;
    const output = await agentService.executePrompt({
      actor: req.user,
      prompt: parsed.body.prompt,
      maxToolCalls: parsed.body.maxToolCalls,
      idempotencyKey,
    });

    res.status(200).json({
      message: "Agent execution processed",
      data: output,
    });
  }),

  confirm: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = confirmPendingActionSchema.parse({ params: req.params, body: req.body });
    const idempotencyKey = req.header("Idempotency-Key") ?? undefined;
    const output = await agentService.confirmPendingAction({
      actor: req.user,
      actionId: parsed.params.actionId,
      approved: parsed.body.approved,
      idempotencyKey,
    });

    res.status(200).json({
      message: "Pending action processed",
      data: output,
    });
  }),
};