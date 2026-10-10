// Entry points of the assistant: run a request (plan, execute, write the answer) and confirm or
// reject a pending destructive action. The steps live in the agent.* modules next to this file.
import { Types } from "mongoose";
import { env } from "../../config/env";
import { AgentAuditLogModel } from "../../models/AgentAuditLog";
import { AgentPendingActionModel, type AgentToolName, type IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { writeAnswer } from "./agent.answer";
import { executeCalls, runAutoRecordSearch } from "./agent.executor";
import { listAgentHistory } from "./agent.history";
import { acquireIdempotency, completeIdempotency, failIdempotency } from "./agent.idempotency";
import { normalizePlannedToolCalls } from "./agent.patientContext";
import { planAfterPatientLookup, planToolCalls } from "./agent.planner";
import { getToolArgsIssue, isToolDestructive } from "./agent.tools";
import {
  type ConfirmPendingActionInput,
  type ExecutePromptInput,
  type ExecutedToolResult,
  extractErrorMessage,
} from "./agent.types";

interface AuditEntry {
  prompt: string;
  plannerResponse: string;
  toolResults: Array<{ tool: AgentToolName; args: Record<string, unknown>; result?: unknown }>;
  pendingActionId?: Types.ObjectId;
  requiresConfirmation: boolean;
  success: boolean;
  errorMessage?: string;
}

async function recordAudit(actor: AuthUser, entry: AuditEntry): Promise<void> {
  await AgentAuditLogModel.create({
    actorId: new Types.ObjectId(actor.id),
    actorRole: actor.role,
    ...entry,
  });
}

export const agentService = {
  listHistory: listAgentHistory,

  async executePrompt(input: ExecutePromptInput): Promise<unknown> {
    let plannerRaw = "";
    let idempotencyRecordId: Types.ObjectId | undefined;

    const idempotency = await acquireIdempotency({
      actorId: input.actor.id,
      scope: "agent_execute",
      key: input.idempotencyKey,
      requestPayload: {
        prompt: input.prompt,
        maxToolCalls: input.maxToolCalls,
      },
    });

    if (idempotency.mode === "replay") {
      return idempotency.responsePayload;
    }

    if (idempotency.mode === "acquired") {
      idempotencyRecordId = idempotency.record._id;
    }

    const finish = async (responsePayload: unknown) => {
      if (idempotencyRecordId) {
        await completeIdempotency(idempotencyRecordId, responsePayload);
      }
      return responsePayload;
    };

    try {
      const planner = await planToolCalls(input.actor, input.prompt, input.maxToolCalls, input.history);
      plannerRaw = planner.raw;

      const calls = normalizePlannedToolCalls(input.prompt, planner.parsed.toolCalls as IAgentToolCall[]);
      if (calls.length === 0) {
        const executionResults: ExecutedToolResult[] = [];
        const autoSearch = await runAutoRecordSearch({
          actor: input.actor,
          prompt: input.prompt,
          calls,
          results: executionResults,
          reason: "Automatic retrieval because planner returned no explicit tool calls",
        });

        await recordAudit(input.actor, {
          prompt: input.prompt,
          plannerResponse: planner.raw,
          toolResults: executionResults,
          requiresConfirmation: false,
          success: true,
        });

        const baseFinalMessage =
          planner.parsed.finalMessage ??
          "No direct tool execution was planned. Provide patient context for more precise retrieval when needed.";

        const written =
          executionResults.length > 0
            ? await writeAnswer(input.actor, input.prompt, executionResults, input.history)
            : null;

        const finalMessage =
          written?.text ??
          (autoSearch.error
            ? `${baseFinalMessage} Automatic retrieval attempt failed: ${autoSearch.error}.`
            : baseFinalMessage);

        return finish({
          provider: planner.provider,
          writerProvider: written ? written.provider : planner.provider,
          requiresConfirmation: false,
          plannerFallbackUsed: planner.fallbackUsed,
          finalMessage,
          plannedToolCalls: [],
          autoChainedToolCalls: autoSearch.autoChainedToolCalls,
          results: executionResults.length > 0 ? executionResults : undefined,
        });
      }

      const hasDestructiveTool = calls.some((call) => isToolDestructive(call.tool));
      if (hasDestructiveTool) {
        // Confirmed actions run with exactly these arguments, so every ID must already be
        // concrete. Never ask the user to approve an action that depends on values (such
        // as a patient) that would only be filled in after approval.
        for (const call of calls) {
          const issue = getToolArgsIssue(call);
          if (issue) {
            throw new ApiError(
              400,
              `The planned ${call.tool} action is missing concrete details (${issue}). ` +
                "Look up the patient, doctor or record first, then ask again with its ID.",
              { tool: call.tool, args: call.args },
            );
          }
        }

        const pending = await AgentPendingActionModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: input.prompt,
          toolCalls: calls,
          status: "pending",
          expiresAt: new Date(Date.now() + env.AGENT_IDEMPOTENCY_TTL_MINUTES * 60 * 1000),
        });

        await recordAudit(input.actor, {
          prompt: input.prompt,
          plannerResponse: planner.raw,
          toolResults: calls.map((call) => ({ tool: call.tool, args: call.args })),
          pendingActionId: pending._id,
          requiresConfirmation: true,
          success: true,
        });

        return finish({
          provider: planner.provider,
          requiresConfirmation: true,
          plannerFallbackUsed: planner.fallbackUsed,
          pendingActionId: pending._id.toString(),
          expiresAt: pending.expiresAt,
          plannedToolCalls: calls,
          message:
            "Confirmation is required before executing destructive tool calls. Use the confirm endpoint with this pendingActionId.",
        });
      }

      const executionResults = await executeCalls(input.actor, input.prompt, calls);

      const followUpCalls = await planAfterPatientLookup({
        actor: input.actor,
        prompt: input.prompt,
        maxToolCalls: input.maxToolCalls,
        history: input.history,
        calls,
        results: executionResults,
      });
      if (followUpCalls.length > 0) {
        executionResults.push(...(await executeCalls(input.actor, input.prompt, followUpCalls)));
        calls.push(...followUpCalls);
      }

      const autoSearch = await runAutoRecordSearch({
        actor: input.actor,
        prompt: input.prompt,
        calls,
        results: executionResults,
        reason: "Automatic retrieval added to answer an open-ended question with available patient context",
      });

      await recordAudit(input.actor, {
        prompt: input.prompt,
        plannerResponse: planner.raw,
        toolResults: executionResults,
        requiresConfirmation: false,
        success: true,
      });

      const written =
        executionResults.length > 0
          ? await writeAnswer(input.actor, input.prompt, executionResults, input.history)
          : null;

      return finish({
        provider: planner.provider,
        writerProvider: written ? written.provider : planner.provider,
        requiresConfirmation: false,
        plannerFallbackUsed: planner.fallbackUsed,
        plannedToolCalls: calls,
        autoChainedToolCalls: autoSearch.autoChainedToolCalls,
        autoRecordSearchError: autoSearch.error ?? undefined,
        results: executionResults,
        finalMessage:
          written?.text ?? planner.parsed.finalMessage ?? "Tools executed successfully, but returned no data.",
      });
    } catch (error) {
      if (idempotencyRecordId) {
        await failIdempotency(idempotencyRecordId, extractErrorMessage(error));
      }

      await recordAudit(input.actor, {
        prompt: input.prompt,
        plannerResponse: plannerRaw || "planning_failed",
        toolResults: [],
        requiresConfirmation: false,
        success: false,
        errorMessage: extractErrorMessage(error),
      });

      throw error;
    }
  },

  async confirmPendingAction(input: ConfirmPendingActionInput): Promise<unknown> {
    let idempotencyRecordId: Types.ObjectId | undefined;

    const idempotency = await acquireIdempotency({
      actorId: input.actor.id,
      scope: "agent_confirm",
      key: input.idempotencyKey,
      requestPayload: {
        actionId: input.actionId,
        approved: input.approved,
      },
    });

    if (idempotency.mode === "replay") {
      return idempotency.responsePayload;
    }

    if (idempotency.mode === "acquired") {
      idempotencyRecordId = idempotency.record._id;
    }

    const finish = async (responsePayload: unknown) => {
      if (idempotencyRecordId) {
        await completeIdempotency(idempotencyRecordId, responsePayload);
      }
      return responsePayload;
    };

    try {
      const pendingActionObjectId = new Types.ObjectId(input.actionId);

      const existing = await AgentPendingActionModel.findById(pendingActionObjectId);

      if (!existing) {
        throw new ApiError(404, `Pending action ${input.actionId} does not exist in the database`);
      }

      if (existing.actorId.toString() !== input.actor.id) {
        throw new ApiError(403, "Only the original requester can confirm this action");
      }

      if (existing.status !== "pending") {
        throw new ApiError(409, `Pending action is already ${existing.status}`);
      }

      if (existing.expiresAt.getTime() < Date.now()) {
        throw new ApiError(410, "Pending action has expired");
      }

      // Claim the action atomically so two concurrent confirmations cannot both run it.
      const pending = await AgentPendingActionModel.findOneAndUpdate(
        { _id: pendingActionObjectId, status: "pending" },
        input.approved
          ? { $set: { status: "approved", approvedAt: new Date() } }
          : { $set: { status: "rejected" } },
        { returnDocument: "after" },
      );

      if (!pending) {
        throw new ApiError(409, "Pending action is already being processed");
      }

      if (!input.approved) {
        await recordAudit(input.actor, {
          prompt: pending.prompt,
          plannerResponse: "pending_action_rejected",
          toolResults: pending.toolCalls.map((call) => ({ tool: call.tool, args: call.args })),
          pendingActionId: pending._id,
          requiresConfirmation: true,
          success: true,
        });

        return finish({
          pendingActionId: pending._id.toString(),
          status: "rejected",
          message: "Pending action was rejected and not executed.",
        });
      }

      const plainCalls: IAgentToolCall[] = pending.toolCalls.map((c) => ({
        tool: c.tool,
        args: c.args as Record<string, unknown>,
        reason: c.reason,
      }));
      let executionResults: ExecutedToolResult[];
      try {
        executionResults = await executeCalls(input.actor, pending.prompt, plainCalls, {
          resolveMissingPatientIds: false,
        });
      } catch (error) {
        // Some calls may already have run, so never return the action to "pending".
        pending.status = "failed";
        await pending.save();
        throw error;
      }

      pending.status = "executed";
      pending.executedAt = new Date();
      await pending.save();

      await recordAudit(input.actor, {
        prompt: pending.prompt,
        plannerResponse: "pending_action_confirmed",
        toolResults: executionResults,
        pendingActionId: pending._id,
        requiresConfirmation: true,
        success: true,
      });

      const written =
        executionResults.length > 0 ? await writeAnswer(input.actor, pending.prompt, executionResults) : null;

      return finish({
        pendingActionId: pending._id.toString(),
        status: "executed",
        writerProvider: written?.provider ?? null,
        results: executionResults,
        message: written?.text ?? "Pending action confirmed and executed successfully.",
      });
    } catch (error) {
      if (idempotencyRecordId) {
        await failIdempotency(idempotencyRecordId, extractErrorMessage(error));
      }

      await recordAudit(input.actor, {
        prompt: `confirm_pending_action:${input.actionId}`,
        plannerResponse: "pending_action_error",
        toolResults: [],
        requiresConfirmation: true,
        success: false,
        errorMessage: extractErrorMessage(error),
      });

      throw error;
    }
  },
};
