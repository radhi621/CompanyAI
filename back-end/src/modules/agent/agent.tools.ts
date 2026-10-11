// The agent's tool registry. Each tool is defined in tools/<domain>.ts; this file assembles them
// and exposes what the conversation loop needs.
import { z } from "zod";
import { AGENT_TOOL_NAMES, type AgentToolName, type IAgentToolCall } from "../../models/AgentPendingAction";
import type { UserRole } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { appointmentsTools } from "./tools/appointments";
import { doctorsTools } from "./tools/doctors";
import { patientsTools } from "./tools/patients";
import { recordsTools } from "./tools/records";
import type { ChatTool } from "../../services/llm/chatTypes";
import type { AgentToolContext, AgentToolDefinition } from "./tools/shared";

const toolRegistry = {
  ...patientsTools,
  ...appointmentsTools,
  ...recordsTools,
  ...doctorsTools,
} satisfies {
  [K in AgentToolName]: AgentToolDefinition<z.ZodTypeAny>;
};

const chatToolsByRole = new Map<UserRole, ChatTool[]>();

/** JSON Schema of a tool's arguments, as the model sees them (input side of the Zod schema). */
function argumentsSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return jsonSchema;
}

/** The tools a role may use, in the shape the AI providers take. */
export const getChatTools = (role: UserRole): ChatTool[] => {
  const cached = chatToolsByRole.get(role);
  if (cached) {
    return cached;
  }

  const tools = AGENT_TOOL_NAMES.filter((name) => toolRegistry[name].allowedRoles.includes(role)).map((name) => ({
    name,
    description: toolRegistry[name].description,
    parameters: argumentsSchema(toolRegistry[name].argsSchema),
  }));
  chatToolsByRole.set(role, tools);
  return tools;
};

export const isAgentToolName = (name: string): name is AgentToolName =>
  (AGENT_TOOL_NAMES as readonly string[]).includes(name);

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