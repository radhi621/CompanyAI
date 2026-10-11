// Planning: asks the AI which tools to call, parses and validates its JSON, and runs the second
// planning turn after a patient lookup.
import { z } from "zod";
import { env } from "../../config/env";
import { AGENT_TOOL_NAMES, type IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { llmRouter } from "../../services/llm/llmRouter";
import { normalizePlannedToolCalls, resolvePatientIdFromExecutionResults } from "./agent.patientContext";
import {
  buildFollowUpPrompt,
  buildNoToolFallbackPrompt,
  buildPlannerPrompt,
  buildPlannerRepairPrompt,
} from "./agent.prompts";
import { isToolAllowedForRole } from "./agent.tools";
import { type ConversationTurn, type ExecutedToolResult, extractErrorMessage } from "./agent.types";

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
    // true when these calls only find IDs the request needs: plan again with their results.
    followUp: z.boolean().optional(),
  })
  .strict();

export interface PlannerOutcome {
  provider: "gemini" | "groq";
  raw: string;
  parsed: z.infer<typeof plannerResponseSchema>;
  fallbackUsed: boolean;
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

export async function planToolCalls(
  actor: AuthUser,
  prompt: string,
  maxToolCalls: number,
  history?: ConversationTurn[],
): Promise<PlannerOutcome> {
  const plannerPrompt = buildPlannerPrompt(actor, prompt, maxToolCalls, history);
  const llmOptions = {
    retriesPerProvider: env.LLM_RETRIES_PER_PROVIDER,
    retryBaseDelayMs: env.LLM_RETRY_BASE_DELAY_MS,
  };
  const jsonOptions = { ...llmOptions, json: true };

  const primaryPlanner = await llmRouter.generate(plannerPrompt, jsonOptions);

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
      history,
    );
    const repairedPlanner = await llmRouter.generate(repairPrompt, jsonOptions);

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
      const fallback = await llmRouter.generate(buildNoToolFallbackPrompt(actor, prompt, history), llmOptions);

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

const PATIENT_LOOKUP_TOOLS = new Set<string>(["search_patient", "list_patients"]);

/** More planning turns run only when the previous one asked for them (or only looked a patient up). */
export function wantsAnotherTurn(planner: PlannerOutcome, calls: IAgentToolCall[]): boolean {
  if (planner.parsed.followUp === true) {
    return true;
  }
  return calls.length > 0 && calls.every((call) => PATIENT_LOOKUP_TOOLS.has(call.tool));
}

export interface NextStep {
  calls: IAgentToolCall[];
  followUp: boolean;
  raw: string;
}

/**
 * A further planning turn, with the results so far. Requests that name a patient or a record
 * need their IDs looked up first (for example: find the patient, list her notes, then delete
 * the last one), so the planner continues from what the earlier calls returned. Calls already
 * made are not repeated. Destructive calls are returned like any other; the caller sends them
 * to the user for confirmation.
 */
export async function planNextStep(input: {
  actor: AuthUser;
  prompt: string;
  remainingToolCalls: number;
  history?: ConversationTurn[];
  calls: IAgentToolCall[];
  results: ExecutedToolResult[];
}): Promise<NextStep> {
  if (input.remainingToolCalls < 1) {
    return { calls: [], followUp: false, raw: "" };
  }

  const followUpPrompt = buildFollowUpPrompt(
    input.prompt,
    input.results,
    resolvePatientIdFromExecutionResults(input.results),
  );

  try {
    const planner = await planToolCalls(input.actor, followUpPrompt, input.remainingToolCalls, input.history);
    const done = new Set(input.calls.map(callKey));
    const calls = normalizePlannedToolCalls(input.prompt, planner.parsed.toolCalls as IAgentToolCall[]).filter(
      (call) => !done.has(callKey(call)),
    );
    return { calls, followUp: planner.parsed.followUp === true, raw: planner.raw };
  } catch (error) {
    console.error(`[Agent] Follow-up planning turn failed: ${extractErrorMessage(error)}`);
    return { calls: [], followUp: false, raw: "" };
  }
}

function callKey(call: IAgentToolCall): string {
  return `${call.tool}:${JSON.stringify(call.args ?? {})}`;
}
