// Running the tool calls of an approved pending action, exactly as the user approved them.
import { ZodError } from "zod";
import type { IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { executeToolCall } from "./agent.tools";
import type { ExecutedToolResult } from "./agent.types";

export async function executeCalls(actor: AuthUser, calls: IAgentToolCall[]): Promise<ExecutedToolResult[]> {
  const results: ExecutedToolResult[] = [];

  for (const call of calls) {
    let result: unknown;

    try {
      result = await executeToolCall(call, { actor });
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.statusCode, error.message, {
          tool: call.tool,
          args: call.args,
          details: error.details,
        });
      }

      if (error instanceof ZodError) {
        throw new ApiError(400, `Invalid args for tool ${call.tool}`, {
          tool: call.tool,
          args: call.args,
          issues: error.flatten(),
        });
      }

      console.error(`[agent] Tool ${call.tool} failed:`, error);
      throw new ApiError(500, `Tool execution failed: ${call.tool}`, {
        tool: call.tool,
        args: call.args,
      });
    }

    results.push({ tool: call.tool, args: call.args, result });
  }

  return results;
}
