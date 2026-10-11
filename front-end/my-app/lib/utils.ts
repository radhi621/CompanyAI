import type { AgentConfirmResult, AgentExecutionResult, AgentToolCall, MessageRole, UserRole } from "./types";
import { API_BASE_URL } from "./config";

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 11)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// For the sign-in and setup screens: drop apiRequest's debugging suffix and explain network failures.
export function readableAuthError(error: unknown): string {
  const message = extractErrorMessage(error);
  if (message.startsWith("Network error")) {
    return `Cannot reach the server at ${API_BASE_URL}. Is the backend running?`;
  }
  return message.split(" | HTTP ")[0];
}

export function formatDateTime(value: string | number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const baseMessage = toOptionalString(payload.message) ?? null;
  const issues = payload.issues;
  if (!isRecord(issues) || !isRecord(issues.fieldErrors)) {
    return baseMessage;
  }

  const fieldMessages: string[] = [];
  for (const [field, value] of Object.entries(issues.fieldErrors)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const firstMessage = value.find((item) => typeof item === "string");
    if (typeof firstMessage === "string") {
      fieldMessages.push(`${field}: ${firstMessage}`);
    }
  }

  if (fieldMessages.length === 0) {
    return baseMessage;
  }

  return `${baseMessage ?? "Validation error"} | ${fieldMessages.join(" | ")}`;
}

export function sanitizeToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const tool = toOptionalString(item.tool);
    if (!tool) {
      return [];
    }

    return [
      {
        tool,
        args: isRecord(item.args) ? item.args : {},
        reason: toOptionalString(item.reason),
      },
    ];
  });
}

export function summarizeExecutionResult(result: AgentExecutionResult): string {
  if (result.requiresConfirmation && result.pendingActionId) {
    // The message names each action and the record it changes.
    return result.message ?? "This action needs your approval before it runs.";
  }

  const readableLines: string[] = [];

  const finalMessage = toOptionalString(result.finalMessage);
  if (finalMessage) {
    readableLines.push(finalMessage);
  } else {
    const message = toOptionalString(result.message);
    if (message) {
      readableLines.push(message);
    }
  }

  if (readableLines.length === 0) {
    return "Done. Execution completed.";
  }

  return readableLines.join("\n");
}

export function summarizeConfirmResult(result: AgentConfirmResult): string {
  return result.message ?? "Pending action confirmed and executed successfully.";
}

export function roleBadgeClass(role: UserRole): string {
  if (role === "admin") {
    return "bg-[#fff0d8] text-[#8a5a00]";
  }

  if (role === "doctor") {
    return "bg-[#e8f1ff] text-[#1c4e98]";
  }

  if (role === "nurse") {
    return "bg-[#eaf9ef] text-[#1a6a3f]";
  }

  return "bg-[#eee9ff] text-[#5a44a8]";
}

export function messageBubbleClass(role: MessageRole): string {
  if (role === "user") {
    return "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#2f2a21] px-4 py-3 text-[#f8f5ef]";
  }

  if (role === "system") {
    return "max-w-[88%] rounded-2xl border border-[#f2d8a8] bg-[#fff7e7] px-4 py-3 text-[#7d5200]";
  }

  return "max-w-[88%] rounded-2xl border border-[#e3dbcf] bg-[#ffffff] px-4 py-3 text-[#2f2a21]";
}

// Same order as the backend's ROLE_LEVEL.
const ROLE_LEVEL: Record<UserRole, number> = { secretary: 1, nurse: 2, doctor: 3, admin: 4 };

/** Mirrors the backend rule: the uploader, or someone with a higher role, may delete or replace. */
export function canModifyUpload(user: { id: string; role: UserRole }, upload: { createdBy: { _id: string } | null; createdByRole: UserRole }): boolean {
  return upload.createdBy?._id === user.id || ROLE_LEVEL[user.role] > ROLE_LEVEL[upload.createdByRole];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
