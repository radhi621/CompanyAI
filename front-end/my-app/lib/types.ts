export type UserRole = "admin" | "doctor" | "nurse" | "secretary";
export type PromptMode = "fetch" | "insert";
export type MessageRole = "user" | "assistant" | "system";
export type ChatScope = "global" | "patient";
export type RagUploadMode = "global" | "patient";

export interface ApiEnvelope<T> {
  message: string;
  data: T;
  details?: unknown;
  issues?: unknown;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
}

export interface AgentExecutionResult {
  provider?: string;
  requiresConfirmation: boolean;
  plannerFallbackUsed?: boolean;
  pendingActionId?: string;
  expiresAt?: string;
  finalMessage?: string;
  message?: string;
  plannedToolCalls?: AgentToolCall[];
  autoChainedToolCalls?: AgentToolCall[];
  results?: unknown;
}

export interface AgentConfirmResult {
  pendingActionId: string;
  status: "rejected" | "executed";
  message: string;
  results?: unknown;
}

export interface PendingActionState {
  id: string;
  expiresAt?: string;
  plannedToolCalls: AgentToolCall[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  raw?: unknown;
}

export interface PatientFolder {
  id: string;
  name: string;
  patientId: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  pendingAction: PendingActionState | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationState {
  activeSessionId: string;
  sessions: Record<string, ChatSession>;
}

export type ConversationMap = Record<string, ConversationState>;

/** Authenticated request helper provided by the page (adds the token, refreshes on 401). */
export type ApiRequest = <T>(path: string, options?: RequestInit & { idempotencyKey?: string }) => Promise<T>;

/** Per-folder chat statistics shown in the sidebar. */
export interface FolderStats {
  folderId: string;
  totalMessages: number;
  sessionCount: number;
  lastMessageAt: number | undefined;
  sessions: Array<{ id: string; messageCount: number; lastMessageAt: number | undefined; isActive: boolean }>;
}
