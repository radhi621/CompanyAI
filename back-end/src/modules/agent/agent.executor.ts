// Running planned tool calls, filling in a patient ID found earlier in the same request.
import { ZodError } from "zod";
import type { IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import {
  buildAutoRecordSearchCall,
  normalizePatientId,
  normalizeRecordSearchQuery,
  normalizeToolLimit,
  resolvePatientIdForAutoRecordSearch,
  resolvePatientIdFromExecutionResults,
  shouldAutoChainRecordSearch,
} from "./agent.patientContext";
import { executeToolCall } from "./agent.tools";
import { type ExecutedToolResult, extractErrorMessage } from "./agent.types";

export async function executeCalls(
  actor: AuthUser,
  prompt: string,
  calls: IAgentToolCall[],
  options: {
    // Fill a missing/invalid patientId from earlier results in the batch. Disabled for
    // confirmed actions, which must run exactly the arguments the user approved.
    resolveMissingPatientIds?: boolean;
  } = {},
): Promise<ExecutedToolResult[]> {
  const results: ExecutedToolResult[] = [];
  const resolveMissingPatientIds = options.resolveMissingPatientIds ?? true;

  const resolvePatientIdFromExecutedResults = (): string | null =>
    resolvePatientIdFromExecutionResults(results);

  for (const call of calls) {
    let effectiveCall = call;

    if (!resolveMissingPatientIds) {
      // Run the approved call as-is.
    } else if (call.tool === "search_medical_records_RAG") {
      const resolvedPatientId = normalizePatientId(call.args?.patientId) ?? resolvePatientIdFromExecutedResults();
      if (resolvedPatientId) {
        effectiveCall = {
          ...call,
          args: {
            ...call.args,
            patientId: resolvedPatientId,
            query: normalizeRecordSearchQuery(call.args?.query, prompt),
            limit: normalizeToolLimit(call.args?.limit, 5),
          },
        };
      }
    } else if ("patientId" in (call.args ?? {})) {
      const currentPatientId = normalizePatientId(call.args?.patientId);
      const resolvedPatientId = currentPatientId ?? resolvePatientIdFromExecutedResults();

      if (resolvedPatientId && resolvedPatientId !== currentPatientId) {
        effectiveCall = {
          ...call,
          args: {
            ...call.args,
            patientId: resolvedPatientId,
          },
        };
      }
    }

    let result: unknown;

    try {
      result = await executeToolCall(effectiveCall, { actor });
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.statusCode, error.message, {
          tool: effectiveCall.tool,
          args: effectiveCall.args,
          details: error.details,
        });
      }

      if (error instanceof ZodError) {
        throw new ApiError(400, `Invalid args for tool ${effectiveCall.tool}`, {
          tool: effectiveCall.tool,
          args: effectiveCall.args,
          issues: error.flatten(),
        });
      }

      console.error(`[agent] Tool ${effectiveCall.tool} failed:`, error);
      throw new ApiError(500, `Tool execution failed: ${effectiveCall.tool}`, {
        tool: effectiveCall.tool,
        args: effectiveCall.args,
      });
    }

    results.push({
      tool: effectiveCall.tool,
      args: effectiveCall.args,
      result,
    });
  }

  return results;
}

/**
 * Adds a search of the patient's uploaded records when the request is an open question about a
 * patient (see shouldAutoChainRecordSearch). Results are appended to `results`; a failed search
 * is reported, not thrown, because the other results still answer the request.
 */
export async function runAutoRecordSearch(input: {
  actor: AuthUser;
  prompt: string;
  calls: IAgentToolCall[];
  results: ExecutedToolResult[];
  reason: string;
}): Promise<{ autoChainedToolCalls: IAgentToolCall[]; error: string | null }> {
  if (!shouldAutoChainRecordSearch(input.prompt, input.calls)) {
    return { autoChainedToolCalls: [], error: null };
  }

  const patientId = resolvePatientIdForAutoRecordSearch(input.prompt, input.calls, input.results);
  if (!patientId) {
    return { autoChainedToolCalls: [], error: null };
  }

  const autoCall = buildAutoRecordSearchCall(patientId, input.prompt, input.reason);
  try {
    const result = await executeToolCall(autoCall, { actor: input.actor });
    input.results.push({ tool: autoCall.tool, args: autoCall.args, result });
    return { autoChainedToolCalls: [autoCall], error: null };
  } catch (error) {
    return { autoChainedToolCalls: [], error: extractErrorMessage(error) };
  }
}
