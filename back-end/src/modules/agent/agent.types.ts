// Types shared by the agent modules.
import type { AgentToolName } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  text: string;
}

export interface ExecutePromptInput {
  actor: AuthUser;
  prompt: string;
  maxToolCalls: number;
  idempotencyKey?: string;
  history?: ConversationTurn[];
}

export interface ConfirmPendingActionInput {
  actor: AuthUser;
  actionId: string;
  approved: boolean;
  idempotencyKey?: string;
}

export interface ListHistoryInput {
  actor: AuthUser;
  limit: number;
  includeFailures: boolean;
  actorId?: string;
}

export interface ExecutedToolResult {
  tool: AgentToolName;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentHistoryToolResult {
  tool: AgentToolName;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface AgentHistoryEntry {
  id: string;
  actorId: string;
  actorRole: AuthUser["role"];
  prompt: string;
  plannerResponse: string;
  toolResults: AgentHistoryToolResult[];
  pendingActionId?: string;
  requiresConfirmation: boolean;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
