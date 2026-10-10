// The agent's tool registry. Each tool is defined in tools/<domain>.ts; this file assembles them
// and exposes what the planner and executor need.
import { z } from "zod";
import { AGENT_TOOL_NAMES, type AgentToolName, type IAgentToolCall } from "../../models/AgentPendingAction";
import type { UserRole } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { appointmentsTools } from "./tools/appointments";
import { doctorsTools } from "./tools/doctors";
import { patientsTools } from "./tools/patients";
import { recordsTools } from "./tools/records";
import type { AgentToolContext, AgentToolDefinition, ToolCatalogItem } from "./tools/shared";

const toolRegistry = {
  ...patientsTools,
  ...appointmentsTools,
  ...recordsTools,
  ...doctorsTools,
} satisfies {
  [K in AgentToolName]: AgentToolDefinition<z.ZodTypeAny>;
};

export const getToolCatalogForPrompt = (): ToolCatalogItem[] => {
  return AGENT_TOOL_NAMES.map((toolName) => {
    const definition = toolRegistry[toolName];
    return {
      name: toolName,
      description: definition.description,
      allowedRoles: definition.allowedRoles,
      destructive: definition.destructive,
      argsShape: definition.argsShape,
    };
  });
};

export const isToolDestructive = (tool: AgentToolName): boolean => {
  return toolRegistry[tool].destructive;
};

export const isToolAllowedForRole = (tool: AgentToolName, role: UserRole): boolean => {
  return toolRegistry[tool].allowedRoles.includes(role);
};

/** Returns a readable description of why a call's args are invalid, or null if they are valid. */
export const getToolArgsIssue = (call: IAgentToolCall): string | null => {
  const result = toolRegistry[call.tool].argsSchema.safeParse(call.args ?? {});
  if (result.success) {
    return null;
  }

  return result.error.issues
    .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
    .join("; ");
};

export const executeToolCall = async (
  call: IAgentToolCall,
  context: AgentToolContext,
): Promise<unknown> => {
  const definition = toolRegistry[call.tool];
  if (!definition.allowedRoles.includes(context.actor.role)) {
    throw new ApiError(403, `Role ${context.actor.role} cannot execute tool ${call.tool}`);
  }

  const parsedArgs = definition.argsSchema.parse(call.args ?? {}) as never;
  return definition.run(parsedArgs, context);
};