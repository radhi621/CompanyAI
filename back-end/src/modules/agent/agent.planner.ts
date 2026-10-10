// Planning: asks the AI which tools to call, parses and validates its JSON, and runs the second
// planning turn after a patient lookup.
import { z } from "zod";
import { env } from "../../config/env";
import { AGENT_TOOL_NAMES, type IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { llmRouter } from "../../services/llm/llmRouter";
import { normalizePlannedToolCalls, resolvePatientIdFromExecutionResults } from "./agent.patientContext";
import { buildNoToolFallbackPrompt, buildPlannerPrompt, buildPlannerRepairPrompt } from "./agent.prompts";
import { isToolAllowedForRole, isToolDestructive } from "./agent.tools";
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
      history,
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

/**
 * Second planning turn. When the user names a patient instead of giving an ID, the planner can
 * only plan the lookup. Once the lookup finds exactly one patient, plan again with that ID so the
 * tool the user actually asked for runs (for example list_patient_notes). Destructive tools are
 * not planned here: they need the user's confirmation on a plan with concrete IDs.
 */
export async function planAfterPatientLookup(input: {
  actor: AuthUser;
  prompt: string;
  maxToolCalls: number;
  history?: ConversationTurn[];
  calls: IAgentToolCall[];
  results: ExecutedToolResult[];
}): Promise<IAgentToolCall[]> {
  const onlyLookups = input.calls.length > 0 && input.calls.every((call) => PATIENT_LOOKUP_TOOLS.has(call.tool));
  const remaining = input.maxToolCalls - input.calls.length;
  const patientId = onlyLookups ? resolvePatientIdFromExecutionResults(input.results) : null;
  if (!patientId || remaining < 1) {
    return [];
  }

  const followUpPrompt = [
    input.prompt,
    `Patient lookup result: the patient's ID is ${patientId}.`,
    "Plan the tool calls that answer the request with this ID. Do not look the patient up again.",
  ].join("\n\n");

  try {
    const planner = await planToolCalls(input.actor, followUpPrompt, remaining, input.history);
    return normalizePlannedToolCalls(input.prompt, planner.parsed.toolCalls as IAgentToolCall[]).filter(
      (call) => !PATIENT_LOOKUP_TOOLS.has(call.tool) && !isToolDestructive(call.tool),
    );
  } catch (error) {
    console.error(`[Agent] Second planning turn failed: ${extractErrorMessage(error)}`);
    return [];
  }
}
