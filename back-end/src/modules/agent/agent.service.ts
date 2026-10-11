// Entry points of the assistant: answer a chat message (agent.chat.ts does the work) and
// confirm or reject a pending action. Both read and update the stored conversation, so the
// assistant remembers earlier steps and what happened to the actions it proposed.
import { Types } from "mongoose";
import { env } from "../../config/env";
import { AgentAuditLogModel } from "../../models/AgentAuditLog";
import { AgentConversationModel, CONVERSATION_TTL_DAYS } from "../../models/AgentConversation";
import { AgentPendingActionModel, type AgentToolName, type IAgentToolCall } from "../../models/AgentPendingAction";
import { PatientModel } from "../../models/Patient";
import type { ChatMessage } from "../../services/llm/chatTypes";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { type ChatPatientContext, answerMessage } from "./agent.chat";
import { describeOutcome } from "./agent.confirmation";
import { executeCalls } from "./agent.executor";
import { listAgentHistory } from "./agent.history";
import { acquireIdempotency, completeIdempotency, failIdempotency } from "./agent.idempotency";
import { assertPatientAccess } from "./tools/shared";
import {
  type ConfirmPendingActionInput,
  type ExecutePromptInput,
  type ExecutedToolResult,
  extractErrorMessage,
} from "./agent.types";

/** Stored messages per conversation; the oldest are dropped beyond this. */
const MAX_STORED_MESSAGES = 300;
const MAX_AUDIT_TRANSCRIPT_CHARS = 20_000;

interface AuditEntry {
  prompt: string;
  plannerResponse: string;
  toolResults: Array<{ tool: AgentToolName; args: Record<string, unknown>; result?: unknown; error?: string }>;
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

const conversationExpiry = () => new Date(Date.now() + CONVERSATION_TTL_DAYS * 24 * 60 * 60 * 1000);

async function loadConversation(actor: AuthUser, conversationId: string, patientId?: string) {
  const conversation = await AgentConversationModel.findOneAndUpdate(
    { actorId: new Types.ObjectId(actor.id), conversationId },
    {
      $setOnInsert: {
        messages: [],
        ...(patientId ? { patientId: new Types.ObjectId(patientId) } : {}),
      },
      $set: { expiresAt: conversationExpiry() },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!conversation) {
    throw new ApiError(500, "Could not open the conversation");
  }
  return conversation;
}

type Conversation = Awaited<ReturnType<typeof loadConversation>>;

async function saveMessages(conversation: Conversation, messages: ChatMessage[]): Promise<void> {
  let kept = messages;
  if (kept.length > MAX_STORED_MESSAGES) {
    // Start at a user message, so no tool result is kept without its call.
    let start = kept.length - MAX_STORED_MESSAGES;
    while (start < kept.length && kept[start].role !== "user") {
      start += 1;
    }
    kept = kept.slice(start);
  }
  conversation.messages = kept;
  conversation.markModified("messages");
  await conversation.save();
}

/** Adds the outcome of a pending action to the conversation it was asked in. */
async function appendToConversation(actor: AuthUser, conversationId: string | undefined, text: string) {
  if (!conversationId) {
    return;
  }
  const conversation = await AgentConversationModel.findOne({
    actorId: new Types.ObjectId(actor.id),
    conversationId,
  });
  if (conversation) {
    await saveMessages(conversation, [...(conversation.messages ?? []), { role: "assistant", text }]);
  }
}

async function patientContext(actor: AuthUser, patientId?: string): Promise<ChatPatientContext | null> {
  if (!patientId) {
    return null;
  }
  await assertPatientAccess(actor, patientId);
  const patient = await PatientModel.findById(patientId).select("firstName lastName cin");
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }
  return { id: patientId, name: `${patient.firstName} ${patient.lastName}`, cin: patient.cin };
}

export const agentService = {
  listHistory: listAgentHistory,

  async executePrompt(input: ExecutePromptInput): Promise<unknown> {
    let idempotencyRecordId: Types.ObjectId | undefined;

    const idempotency = await acquireIdempotency({
      actorId: input.actor.id,
      scope: "agent_execute",
      key: input.idempotencyKey,
      requestPayload: {
        prompt: input.prompt,
        conversationId: input.conversationId,
        patientId: input.patientId ?? null,
      },
    });

    if (idempotency.mode === "replay") {
      return idempotency.responsePayload;
    }

    if (idempotency.mode === "acquired") {
      idempotencyRecordId = idempotency.record._id;
    }

    try {
      const patient = await patientContext(input.actor, input.patientId);
      const conversation = await loadConversation(input.actor, input.conversationId, input.patientId);

      const messages: ChatMessage[] = [...(conversation.messages ?? [])];
      const storedBefore = messages.length;
      const reply = await answerMessage({ actor: input.actor, messages, text: input.prompt, patient });

      let pendingActionId: Types.ObjectId | undefined;
      let pendingExpiresAt: Date | undefined;
      if (reply.pending.length > 0) {
        const pending = await AgentPendingActionModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: input.prompt,
          conversationId: input.conversationId,
          toolCalls: reply.pending,
          status: "pending",
          expiresAt: new Date(Date.now() + env.AGENT_IDEMPOTENCY_TTL_MINUTES * 60 * 1000),
        });
        pendingActionId = pending._id;
        pendingExpiresAt = pending.expiresAt;
      }

      await saveMessages(conversation, messages);

      await recordAudit(input.actor, {
        prompt: input.prompt,
        plannerResponse: JSON.stringify(messages.slice(storedBefore)).slice(0, MAX_AUDIT_TRANSCRIPT_CHARS),
        toolResults: [...reply.executed, ...reply.pending.map((call) => ({ tool: call.tool, args: call.args }))],
        pendingActionId,
        requiresConfirmation: reply.pending.length > 0,
        success: true,
      });

      const responsePayload = {
        provider: reply.provider,
        conversationId: input.conversationId,
        requiresConfirmation: reply.pending.length > 0,
        pendingActionId: pendingActionId?.toString(),
        expiresAt: pendingExpiresAt,
        plannedToolCalls: reply.pending,
        results: reply.executed,
        finalMessage: reply.text,
        message: reply.text,
      };

      if (idempotencyRecordId) {
        await completeIdempotency(idempotencyRecordId, responsePayload);
      }

      return responsePayload;
    } catch (error) {
      if (idempotencyRecordId) {
        await failIdempotency(idempotencyRecordId, extractErrorMessage(error));
      }

      await recordAudit(input.actor, {
        prompt: input.prompt,
        plannerResponse: "chat_failed",
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

      const plainCalls: IAgentToolCall[] = pending.toolCalls.map((c) => ({
        tool: c.tool,
        args: c.args as Record<string, unknown>,
        reason: c.reason,
      }));

      if (!input.approved) {
        const message = "Rejected: the action was not run and nothing was changed.";
        await appendToConversation(input.actor, pending.conversationId, message);
        await recordAudit(input.actor, {
          prompt: pending.prompt,
          plannerResponse: "pending_action_rejected",
          toolResults: plainCalls.map((call) => ({ tool: call.tool, args: call.args })),
          pendingActionId: pending._id,
          requiresConfirmation: true,
          success: true,
        });

        return finish({ pendingActionId: pending._id.toString(), status: "rejected", message });
      }

      let executionResults: ExecutedToolResult[];
      try {
        executionResults = await executeCalls(input.actor, plainCalls);
      } catch (error) {
        // Some calls may already have run, so never return the action to "pending".
        pending.status = "failed";
        await pending.save();
        await appendToConversation(
          input.actor,
          pending.conversationId,
          `The approved action failed: ${extractErrorMessage(error)}`,
        );
        throw error;
      }

      pending.status = "executed";
      pending.executedAt = new Date();
      await pending.save();

      const message = describeOutcome(plainCalls, executionResults);
      await appendToConversation(input.actor, pending.conversationId, message);

      await recordAudit(input.actor, {
        prompt: pending.prompt,
        plannerResponse: "pending_action_confirmed",
        toolResults: executionResults,
        pendingActionId: pending._id,
        requiresConfirmation: true,
        success: true,
      });

      return finish({
        pendingActionId: pending._id.toString(),
        status: "executed",
        results: executionResults,
        message,
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
