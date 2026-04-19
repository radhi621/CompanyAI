import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../config/env";
import { AgentAuditLogModel } from "../../models/AgentAuditLog";
import {
  AGENT_TOOL_NAMES,
  AgentPendingActionModel,
  type AgentToolName,
  type IAgentToolCall,
} from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { llmRouter } from "../../services/llm/llmRouter";
import { acquireIdempotency, completeIdempotency, failIdempotency } from "./agent.idempotency";
import {
  executeToolCall,
  getToolCatalogForPrompt,
  isToolAllowedForRole,
  isToolDestructive,
} from "./agent.tools";

const MAX_PLANNER_OUTPUT_CHARS = 60_000;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const plannerToolCallSchema = z
  .object({
    tool: z.enum(AGENT_TOOL_NAMES),
    args: z
      .record(z.string().min(1).max(120), z.unknown())
      .default({})
      .refine((value) => Object.keys(value).length <= 100, {
        message: "Tool args object is too large",
      }),
    reason: z.string().max(500).optional(),
  })
  .strict();

const plannerResponseSchema = z
  .object({
    thought: z.string().max(3000).optional(),
    toolCalls: z.array(plannerToolCallSchema).max(10).default([]),
    finalMessage: z.string().max(6000).optional(),
  })
  .strict();

interface ExecutePromptInput {
  actor: AuthUser;
  prompt: string;
  maxToolCalls: number;
  idempotencyKey?: string;
}

interface ConfirmPendingActionInput {
  actor: AuthUser;
  actionId: string;
  approved: boolean;
  idempotencyKey?: string;
}

interface PlannerOutcome {
  provider: "gemini" | "groq";
  raw: string;
  parsed: z.infer<typeof plannerResponseSchema>;
  fallbackUsed: boolean;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePlannerText(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function extractBalancedJsonObjects(raw: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return Array.from(new Set(candidates));
}

function assertSafeJsonValue(value: unknown, depth = 0): void {
  if (depth > 12) {
    throw new ApiError(400, "Tool args depth exceeded allowed limit");
  }

  if (Array.isArray(value)) {
    if (value.length > 300) {
      throw new ApiError(400, "Tool args array is too large");
    }

    value.forEach((item) => {
      assertSafeJsonValue(item, depth + 1);
    });
    return;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 200) {
      throw new ApiError(400, "Tool args object has too many keys");
    }

    for (const [key, nested] of entries) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new ApiError(400, `Unsafe key detected in tool args: ${key}`);
      }
      assertSafeJsonValue(nested, depth + 1);
    }
  }
}

function parsePlannerResponse(raw: string): z.infer<typeof plannerResponseSchema> {
  const normalized = normalizePlannerText(raw);

  if (!normalized) {
    throw new ApiError(502, "Planner returned empty output");
  }

  if (normalized.length > MAX_PLANNER_OUTPUT_CHARS) {
    throw new ApiError(502, "Planner output is too large to parse safely");
  }

  const candidates = [normalized, ...extractBalancedJsonObjects(normalized)];

  for (const candidate of candidates) {
    try {
      const parsedJson = JSON.parse(candidate);
      const parsed = plannerResponseSchema.parse(parsedJson);
      parsed.toolCalls.forEach((call) => {
        assertSafeJsonValue(call.args);
      });
      return parsed;
    } catch {
      continue;
    }
  }

  throw new ApiError(502, "Planner did not return valid JSON following the required schema");
}

function buildPlannerPrompt(actor: AuthUser, prompt: string, maxToolCalls: number): string {
  const toolCatalog = JSON.stringify(getToolCatalogForPrompt(), null, 2);

  return [
    "You are an orchestration planner for MediAssist IA.",
    `Requester role: ${actor.role}`,
    "Plan tool calls using only allowed tools for the request.",
    `Limit planned tool calls to at most ${maxToolCalls}.`,
    "Return only a JSON object with this exact shape:",
    '{"thought":"optional","toolCalls":[{"tool":"...","args":{},"reason":"optional"}],"finalMessage":"optional"}',
    "Do not wrap JSON in markdown.",
    "Available tools:",
    toolCatalog,
    "User request:",
    prompt,
  ].join("\n\n");
}

function buildPlannerRepairPrompt(
  actor: AuthUser,
  prompt: string,
  maxToolCalls: number,
  invalidOutput: string,
  parseErrorMessage: string,
): string {
  const toolCatalog = JSON.stringify(getToolCatalogForPrompt(), null, 2);

  return [
    "You are repairing a malformed planner output.",
    `Requester role: ${actor.role}`,
    `Original request: ${prompt}`,
    `Max allowed tool calls: ${maxToolCalls}`,
    "Fix the output and return only valid JSON with exact shape:",
    '{"thought":"optional","toolCalls":[{"tool":"...","args":{},"reason":"optional"}],"finalMessage":"optional"}',
    "Do not use markdown fences.",
    `Previous parse issue: ${parseErrorMessage}`,
    "Allowed tool catalog:",
    toolCatalog,
    "Invalid output to repair:",
    invalidOutput,
  ].join("\n\n");
}

function buildNoToolFallbackPrompt(actor: AuthUser, prompt: string): string {
  return [
    "You are MediAssist IA.",
    `Requester role: ${actor.role}`,
    "Provide a concise and safe response without performing any database-modifying action.",
    "Do not imply that actions were executed.",
    "Respond in plain text only.",
    "User request:",
    prompt,
  ].join("\n\n");
}

function toToolCalls(
  parsed: z.infer<typeof plannerResponseSchema>,
  maxToolCalls: number,
): IAgentToolCall[] {
  return parsed.toolCalls.slice(0, maxToolCalls).map((call) => ({
    tool: call.tool,
    args: call.args,
    reason: call.reason,
  }));
}

function assertRolePermissionForCalls(actor: AuthUser, calls: IAgentToolCall[]): void {
  for (const call of calls) {
    if (!isToolAllowedForRole(call.tool, actor.role)) {
      throw new ApiError(403, `Planner selected unauthorized tool ${call.tool} for role ${actor.role}`);
    }
  }
}

async function planToolCalls(
  actor: AuthUser,
  prompt: string,
  maxToolCalls: number,
): Promise<PlannerOutcome> {
  const plannerPrompt = buildPlannerPrompt(actor, prompt, maxToolCalls);
  const llmOptions = {
    retriesPerProvider: env.LLM_RETRIES_PER_PROVIDER,
    retryBaseDelayMs: env.LLM_RETRY_BASE_DELAY_MS,
  };

  const primaryPlanner = await llmRouter.generate(plannerPrompt, llmOptions);

  try {
    const parsed = parsePlannerResponse(primaryPlanner.text);
    const calls = toToolCalls(parsed, maxToolCalls);
    assertRolePermissionForCalls(actor, calls);

    return {
      provider: primaryPlanner.provider,
      raw: primaryPlanner.text,
      parsed: {
        ...parsed,
        toolCalls: calls,
      },
      fallbackUsed: false,
    };
  } catch (primaryParseError) {
    const repairPrompt = buildPlannerRepairPrompt(
      actor,
      prompt,
      maxToolCalls,
      primaryPlanner.text,
      extractErrorMessage(primaryParseError),
    );
    const repairedPlanner = await llmRouter.generate(repairPrompt, llmOptions);

    try {
      const parsed = parsePlannerResponse(repairedPlanner.text);
      const calls = toToolCalls(parsed, maxToolCalls);
      assertRolePermissionForCalls(actor, calls);

      return {
        provider: repairedPlanner.provider,
        raw: `${primaryPlanner.text}\n\n[repair_output]\n${repairedPlanner.text}`,
        parsed: {
          ...parsed,
          toolCalls: calls,
        },
        fallbackUsed: false,
      };
    } catch {
      const fallback = await llmRouter.generate(buildNoToolFallbackPrompt(actor, prompt), llmOptions);

      return {
        provider: fallback.provider,
        raw: `${primaryPlanner.text}\n\n[repair_output]\n${repairedPlanner.text}\n\n[fallback_output]\n${fallback.text}`,
        parsed: {
          thought: "planner_fallback_no_tools",
          toolCalls: [],
          finalMessage: fallback.text,
        },
        fallbackUsed: true,
      };
    }
  }
}

async function executeCalls(
  actor: AuthUser,
  calls: IAgentToolCall[],
): Promise<Array<{ tool: AgentToolName; args: Record<string, unknown>; result: unknown }>> {
  const results: Array<{ tool: AgentToolName; args: Record<string, unknown>; result: unknown }> = [];

  for (const call of calls) {
    let result: unknown;

    try {
      result = await executeToolCall(call, { actor });
    } catch (error) {
      throw new ApiError(500, `Tool execution failed: ${call.tool}`, {
        tool: call.tool,
        args: call.args,
        error: extractErrorMessage(error),
      });
    }

    results.push({
      tool: call.tool,
      args: call.args,
      result,
    });
  }

  return results;
}

export const agentService = {
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

    try {
      const planner = await planToolCalls(input.actor, input.prompt, input.maxToolCalls);
      plannerRaw = planner.raw;

      const calls = planner.parsed.toolCalls as IAgentToolCall[];
      if (calls.length === 0) {
        await AgentAuditLogModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: input.prompt,
          plannerResponse: planner.raw,
          toolResults: [],
          requiresConfirmation: false,
          success: true,
        });

        const responsePayload = {
          provider: planner.provider,
          requiresConfirmation: false,
          plannerFallbackUsed: planner.fallbackUsed,
          finalMessage:
            planner.parsed.finalMessage ??
            "No tool execution was required for this request based on planner output.",
          plannedToolCalls: [],
        };

        if (idempotencyRecordId) {
          await completeIdempotency(idempotencyRecordId, responsePayload);
        }

        return responsePayload;
      }

      const hasDestructiveTool = calls.some((call) => isToolDestructive(call.tool));
      if (hasDestructiveTool) {
        const pending = await AgentPendingActionModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: input.prompt,
          toolCalls: calls,
          status: "pending",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        await AgentAuditLogModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: input.prompt,
          plannerResponse: planner.raw,
          toolResults: calls.map((call) => ({ tool: call.tool, args: call.args })),
          pendingActionId: pending._id,
          requiresConfirmation: true,
          success: true,
        });

        const responsePayload = {
          provider: planner.provider,
          requiresConfirmation: true,
          plannerFallbackUsed: planner.fallbackUsed,
          pendingActionId: pending._id.toString(),
          expiresAt: pending.expiresAt,
          plannedToolCalls: calls,
          message:
            "Confirmation is required before executing destructive tool calls. Use the confirm endpoint with this pendingActionId.",
        };

        if (idempotencyRecordId) {
          await completeIdempotency(idempotencyRecordId, responsePayload);
        }

        return responsePayload;
      }

      const executionResults = await executeCalls(input.actor, calls);

      await AgentAuditLogModel.create({
        actorId: new Types.ObjectId(input.actor.id),
        actorRole: input.actor.role,
        prompt: input.prompt,
        plannerResponse: planner.raw,
        toolResults: executionResults,
        requiresConfirmation: false,
        success: true,
      });

      const responsePayload = {
        provider: planner.provider,
        requiresConfirmation: false,
        plannerFallbackUsed: planner.fallbackUsed,
        plannedToolCalls: calls,
        results: executionResults,
        finalMessage:
          planner.parsed.finalMessage ?? "Tools executed successfully. Review tool results for details.",
      };

      if (idempotencyRecordId) {
        await completeIdempotency(idempotencyRecordId, responsePayload);
      }

      return responsePayload;
    } catch (error) {
      if (idempotencyRecordId) {
        await failIdempotency(idempotencyRecordId, extractErrorMessage(error));
      }

      await AgentAuditLogModel.create({
        actorId: new Types.ObjectId(input.actor.id),
        actorRole: input.actor.role,
        prompt: input.prompt,
        plannerResponse: plannerRaw || "",
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

    try {
      const pending = await AgentPendingActionModel.findOne({
        _id: new Types.ObjectId(input.actionId),
        status: "pending",
        expiresAt: { $gt: new Date() },
      });

      if (!pending) {
        throw new ApiError(404, "Pending action not found or expired");
      }

      if (pending.actorId.toString() !== input.actor.id) {
        throw new ApiError(403, "Only the original requester can confirm this action");
      }

      if (!input.approved) {
        pending.status = "rejected";
        await pending.save();

        await AgentAuditLogModel.create({
          actorId: new Types.ObjectId(input.actor.id),
          actorRole: input.actor.role,
          prompt: pending.prompt,
          plannerResponse: "pending_action_rejected",
          toolResults: pending.toolCalls.map((call) => ({ tool: call.tool, args: call.args })),
          pendingActionId: pending._id,
          requiresConfirmation: true,
          success: true,
        });

        const responsePayload = {
          pendingActionId: pending._id.toString(),
          status: "rejected",
          message: "Pending action was rejected and not executed.",
        };

        if (idempotencyRecordId) {
          await completeIdempotency(idempotencyRecordId, responsePayload);
        }

        return responsePayload;
      }

      pending.status = "approved";
      pending.approvedAt = new Date();
      await pending.save();

      const executionResults = await executeCalls(input.actor, pending.toolCalls);

      pending.status = "executed";
      pending.executedAt = new Date();
      await pending.save();

      await AgentAuditLogModel.create({
        actorId: new Types.ObjectId(input.actor.id),
        actorRole: input.actor.role,
        prompt: pending.prompt,
        plannerResponse: "pending_action_confirmed",
        toolResults: executionResults,
        pendingActionId: pending._id,
        requiresConfirmation: true,
        success: true,
      });

      const responsePayload = {
        pendingActionId: pending._id.toString(),
        status: "executed",
        results: executionResults,
        message: "Pending action confirmed and executed successfully.",
      };

      if (idempotencyRecordId) {
        await completeIdempotency(idempotencyRecordId, responsePayload);
      }

      return responsePayload;
    } catch (error) {
      if (idempotencyRecordId) {
        await failIdempotency(idempotencyRecordId, extractErrorMessage(error));
      }

      await AgentAuditLogModel.create({
        actorId: new Types.ObjectId(input.actor.id),
        actorRole: input.actor.role,
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
