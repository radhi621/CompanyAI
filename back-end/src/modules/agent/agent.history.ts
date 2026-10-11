// Reading the agent audit log back as history entries.
import { Types } from "mongoose";
import type { AgentToolName } from "../../models/AgentPendingAction";
import { AgentAuditLogModel } from "../../models/AgentAuditLog";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import type { AgentHistoryEntry, AgentHistoryToolResult, ListHistoryInput } from "./agent.types";

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

export async function listAgentHistory(input: ListHistoryInput): Promise<AgentHistoryEntry[]> {
  if (input.actorId && input.actor.role !== "admin") {
    throw new ApiError(403, "Only admin can query history for another user");
  }

  const targetActorId = input.actorId ?? input.actor.id;
  const query: Record<string, unknown> = {
    actorId: new Types.ObjectId(targetActorId),
  };

  if (!input.includeFailures) {
    query.success = true;
  }

  const safeLimit = Math.max(1, Math.min(100, Math.trunc(input.limit)));

  const logs = await AgentAuditLogModel.find(query)
    .select(
      "actorId actorRole prompt plannerResponse toolResults pendingActionId requiresConfirmation success errorMessage createdAt updatedAt",
    )
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return logs.map((log) => {
    const toolResults = Array.isArray(log.toolResults)
      ? log.toolResults
          .flatMap((item) => {
            const normalized =
              item && typeof item === "object"
                ? (item as {
                    tool?: unknown;
                    args?: unknown;
                    result?: unknown;
                    error?: unknown;
                  })
                : null;

            if (!normalized || typeof normalized.tool !== "string") {
              return [];
            }

            return [
              {
                tool: normalized.tool as AgentToolName,
                args:
                  normalized.args &&
                  typeof normalized.args === "object" &&
                  !Array.isArray(normalized.args)
                    ? (normalized.args as Record<string, unknown>)
                    : {},
                result: normalized.result,
                error: typeof normalized.error === "string" ? normalized.error : undefined,
              } satisfies AgentHistoryToolResult,
            ];
          })
      : [];

    return {
      id: String(log._id),
      actorId: String(log.actorId),
      actorRole: log.actorRole as AuthUser["role"],
      prompt: typeof log.prompt === "string" ? log.prompt : "",
      plannerResponse: typeof log.plannerResponse === "string" ? log.plannerResponse : "",
      toolResults,
      pendingActionId: log.pendingActionId ? String(log.pendingActionId) : undefined,
      requiresConfirmation: Boolean(log.requiresConfirmation),
      success: Boolean(log.success),
      errorMessage: typeof log.errorMessage === "string" ? log.errorMessage : undefined,
      createdAt: toIsoString(log.createdAt),
      updatedAt: toIsoString(log.updatedAt),
    } satisfies AgentHistoryEntry;
  });
}
