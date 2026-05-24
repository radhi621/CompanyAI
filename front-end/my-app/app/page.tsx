"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "../components/Calendar";

type UserRole = "admin" | "doctor" | "nurse" | "secretary";
type PromptMode = "fetch" | "insert";
type MessageRole = "user" | "assistant" | "system";
type ChatScope = "global" | "patient";
type RagUploadMode = "global" | "patient";

interface ApiEnvelope<T> {
  message: string;
  data: T;
  details?: unknown;
  issues?: unknown;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
}

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
}

interface AgentExecutionResult {
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

interface AgentConfirmResult {
  pendingActionId: string;
  status: "rejected" | "executed";
  message: string;
  results?: unknown;
}

interface ExecutedToolResult {
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface PendingActionState {
  id: string;
  expiresAt?: string;
  plannedToolCalls: AgentToolCall[];
}

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  raw?: unknown;
}

interface PatientFolder {
  id: string;
  name: string;
  patientId: string;
  createdAt: number;
}

interface ChatSession {
  id: string;
  messages: ChatMessage[];
  pendingAction: PendingActionState | null;
  createdAt: number;
  updatedAt: number;
}

interface ConversationState {
  activeSessionId: string;
  sessions: Record<string, ChatSession>;
}

type ConversationMap = Record<string, ConversationState>;

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";
const TOKEN_STORAGE_KEY = "mediassist_access_token";
const CHAT_SCOPE_STORAGE_KEY = "mediassist_chat_scope_v1";
const PATIENT_FOLDERS_STORAGE_KEY = "mediassist_patient_folders_v2";
const ACTIVE_FOLDER_STORAGE_KEY = "mediassist_active_folder_v2";
const CONVERSATIONS_STORAGE_KEY = "mediassist_conversations_v2";
const GLOBAL_CONVERSATION_ID = "__global__";

const QUICK_ACTIONS: Array<{ title: string; mode: PromptMode; prompt: string }> = [
  {
    title: "Today schedule",
    mode: "fetch",
    prompt: "Show me today schedule in Africa/Casablanca and summarize by doctor.",
  },
  {
    title: "List patients",
    mode: "fetch",
    prompt: "List all accessible patients with IDs, CIN, and key profile fields.",
  },
  {
    title: "Find by CIN",
    mode: "fetch",
    prompt: "Find patient by CIN AB123456 and show basic profile.",
  },
  {
    title: "Patient summary",
    mode: "fetch",
    prompt: "Get full summary for patient <PATIENT_ID>.",
  },
  {
    title: "List appointments",
    mode: "fetch",
    prompt: "List all upcoming appointments with patient name, doctor, date, and status.",
  },
  {
    title: "Check availability",
    mode: "fetch",
    prompt: "Check availability for doctor <DOCTOR_ID> on 2026-05-25.",
  },
  {
    title: "List doctors",
    mode: "fetch",
    prompt: "List all doctors with specialty, license number, and active status.",
  },
  {
    title: "Uncontacted patients",
    mode: "fetch",
    prompt: "List patients without recent contact in my department.",
  },
  {
    title: "Patient notes",
    mode: "fetch",
    prompt: "List all notes for patient <PATIENT_ID>.",
  },
  {
    title: "Search medical records",
    mode: "fetch",
    prompt: "Search medical records for patient <PATIENT_ID> with keyword <KEYWORD>.",
  },
  {
    title: "Search global knowledge",
    mode: "fetch",
    prompt: "Search global medical knowledge about <TOPIC>.",
  },
  {
    title: "Create patient",
    mode: "insert",
    prompt:
      "Create a patient with first name Youssef, last name Amrani, CIN AB123456, phone +212600000000, email youssef.amrani@example.com, and pathologies hypertension and asthma.",
  },
  {
    title: "Update patient",
    mode: "insert",
    prompt: "Update patient <PATIENT_ID> with new phone +212600000001.",
  },
  {
    title: "Create appointment",
    mode: "insert",
    prompt:
      "Create an appointment for patient <PATIENT_ID> with doctor <DOCTOR_ID> on 2026-04-20 at 10:00 for post-op follow up, 60 minutes.",
  },
  {
    title: "Cancel appointment",
    mode: "insert",
    prompt: "Cancel appointment <APPOINTMENT_ID> due to patient rescheduling.",
  },
  {
    title: "Add patient note",
    mode: "insert",
    prompt: "Add a note for patient <PATIENT_ID>: <NOTE_TEXT>.",
  },
  {
    title: "Delete patient note",
    mode: "insert",
    prompt: "Delete patient note <NOTE_ID>.",
  },
  {
    title: "Create staff account",
    mode: "insert",
    prompt: "Create a staff account for <NAME>, email <EMAIL>, password <PASSWORD>, role <ROLE>.",
  },
  {
    title: "Create doctor profile",
    mode: "insert",
    prompt: "Create a doctor profile for <NAME>, specialty <SPECIALTY>, license number <LICENSE>.",
  },
];

function normalizeApiBaseUrl(rawValue: string | undefined): string {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath =
      parsed.pathname === "/" || parsed.pathname.trim().length === 0
        ? "/api/v1"
        : parsed.pathname.replace(/\/+$/, "");

    return `${parsed.origin}${normalizedPath}`;
  } catch {
    const cleaned = trimmed.replace(/\/+$/, "");
    return cleaned || DEFAULT_API_BASE_URL;
  }
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 11)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function formatDateTime(value: string | number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatApiErrorMessage(payload: unknown): string | null {
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

function sanitizeToolCalls(value: unknown): AgentToolCall[] {
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

function toExecutedToolResults(value: unknown): ExecutedToolResult[] {
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
        args: isRecord(item.args) ? item.args : undefined,
        result: item.result,
        error: toOptionalString(item.error),
      },
    ];
  });
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function humanizeToolName(tool: string): string {
  return tool.replaceAll("_", " ").trim();
}

function pickListPreviewLabel(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const firstName = toOptionalString(value.firstName);
  const lastName = toOptionalString(value.lastName);
  if (firstName || lastName) {
    return `${firstName ?? ""} ${lastName ?? ""}`.trim();
  }

  return (
    toOptionalString(value.name) ??
    toOptionalString(value.fullName) ??
    toOptionalString(value.title) ??
    toOptionalString(value.reason) ??
    toOptionalString(value.cin) ??
    null
  );
}

function summarizeSingleToolResult(tool: string, result: unknown): string {
  if (tool === "search_medical_records_RAG" || tool === "search_global_knowledge_RAG") {
    if (isRecord(result) && Array.isArray(result.matches)) {
      const matches = result.matches;
      if (matches.length === 0) {
        return "No relevant context found.";
      }

      const first = matches[0];
      if (isRecord(first) && typeof first.content === "string") {
        return `${matches.length} context chunk(s) found. Top match: \"${truncateText(
          first.content.replace(/\s+/g, " ").trim(),
          180,
        )}\"`;
      }

      return `${matches.length} context chunk(s) found.`;
    }
  }

  if (isRecord(result)) {
    const explicitMessage = toOptionalString(result.message);
    if (explicitMessage) {
      return explicitMessage;
    }

    const preferredArrayKey = ["patients", "doctors", "appointments", "matches"].find((key) =>
      Array.isArray(result[key]),
    );

    if (preferredArrayKey) {
      const entries = result[preferredArrayKey] as unknown[];
      if (entries.length === 0) {
        return `${preferredArrayKey} list is empty.`;
      }

      const previews = entries
        .map((entry) => pickListPreviewLabel(entry))
        .filter((label): label is string => Boolean(label))
        .slice(0, 3);

      if (previews.length > 0) {
        return `${entries.length} item(s). Example: ${previews.join(" | ")}${
          entries.length > previews.length ? " | ..." : ""
        }`;
      }

      return `${entries.length} item(s) returned.`;
    }

    const genericArrayEntry = Object.entries(result).find(([, value]) => Array.isArray(value));
    if (genericArrayEntry) {
      const [key, value] = genericArrayEntry;
      return `${Array.isArray(value) ? value.length : 0} ${key} item(s) returned.`;
    }

    const idCandidate = toOptionalString(result._id) ?? toOptionalString(result.id);
    if (idCandidate) {
      return `Completed (id: ${idCandidate}).`;
    }

    const preview = truncateText(JSON.stringify(result), 220);
    return preview;
  }

  if (Array.isArray(result)) {
    return `${result.length} item(s) returned.`;
  }

  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "number" || typeof result === "boolean") {
    return String(result);
  }

  return "Completed.";
}

function summarizeToolExecutionLines(results: unknown): string[] {
  const toolResults = toExecutedToolResults(results);
  if (toolResults.length === 0) {
    return [];
  }

  const lines = toolResults.map((entry) => {
    if (entry.error) {
      return `- ${humanizeToolName(entry.tool)}: Failed (${entry.error})`;
    }

    return `- ${humanizeToolName(entry.tool)}: ${summarizeSingleToolResult(entry.tool, entry.result)}`;
  });

  return ["Tool results:", ...lines];
}

function summarizeExecutionResult(result: AgentExecutionResult): string {
  if (result.requiresConfirmation && result.pendingActionId) {
    const callSummary = sanitizeToolCalls(result.plannedToolCalls)
      .map((call) => call.tool)
      .join(", ");

    const callLine = callSummary ? `Planned tools: ${callSummary}.` : "";
    return [result.message ?? "This action requires confirmation before execution.", callLine]
      .filter((line) => line.length > 0)
      .join(" ");
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

function summarizeConfirmResult(result: AgentConfirmResult): string {
  return result.message ?? "Pending action confirmed and executed successfully.";
}

function buildPromptWithMode(input: {
  mode: PromptMode;
  prompt: string;
  scope: ChatScope;
  folder?: PatientFolder;
}): string {
  const modeInstruction =
    input.mode === "fetch"
      ? "Mode: Fetch and summarize data only unless the user explicitly requests mutation."
      : "Mode: Insert or update data when needed. If destructive, require pending confirmation.";

  const ragScopeInstruction =
    input.scope === "global"
      ? [
          "RAG Scope:",
          "- Primary: Global Knowledge RAG",
          "- Use tool search_global_knowledge_RAG when contextual evidence is needed.",
        ].join("\n")
      : [
          "RAG Scope:",
          "- Primary: Patient-specific RAG for the active patient folder",
          "- Secondary fallback: Global Knowledge RAG",
          "- Use search_medical_records_RAG with this patientId first, then search_global_knowledge_RAG if needed.",
          `- Active patientId: ${input.folder?.patientId ?? "unknown"}`,
          `- Active folder: ${input.folder?.name ?? "unknown"}`,
        ].join("\n");

  return [modeInstruction, ragScopeInstruction, "Current user request:", input.prompt].join("\n\n");
}

function roleBadgeClass(role: UserRole): string {
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

function messageBubbleClass(role: MessageRole): string {
  if (role === "user") {
    return "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#2f2a21] px-4 py-3 text-[#f8f5ef]";
  }

  if (role === "system") {
    return "max-w-[88%] rounded-2xl border border-[#f2d8a8] bg-[#fff7e7] px-4 py-3 text-[#7d5200]";
  }

  return "max-w-[88%] rounded-2xl border border-[#e3dbcf] bg-[#ffffff] px-4 py-3 text-[#2f2a21]";
}

function ScopeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function UploadIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 13V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 7.5L10 4l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="3" y="4" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 2v2M13.5 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="11" r="0.8" fill="currentColor" />
      <circle cx="10" cy="11" r="0.8" fill="currentColor" />
      <circle cx="13" cy="11" r="0.8" fill="currentColor" />
    </svg>
  );
}

function UserIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 16c1.3-2.2 3.3-3.3 5.5-3.3S14.2 13.8 15.5 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ControlsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="6" r="1.1" fill="currentColor" />
      <circle cx="12" cy="10" r="1.1" fill="currentColor" />
      <circle cx="9" cy="14" r="1.1" fill="currentColor" />
    </svg>
  );
}

function QuickActionsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M10.8 2.8 6 9.3h3.1L8.7 17l5.4-6.7h-3.3l.1-7.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function FetchIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <circle cx="9" cy="9" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.3 12.3 3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function InsertIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ToolLimitIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <rect x="3.5" y="4" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12.3" y="4" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3.5" y="11.8" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12.3" y="11.8" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function quickActionIcon(title: string): ReactNode {
  if (title.toLowerCase().includes("schedule")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6.5 3.3v2.2M13.5 3.3v2.2M3.5 8.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("find")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8.6" cy="8.6" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11.6 11.6 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("appointment")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 8.3v4M8 10.3h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("patient") && title.toLowerCase().includes("create")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 15c1.2-2 2.8-3 4.5-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13.5 8v5M11 10.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("patients")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="7" cy="7.4" r="2.2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13.1" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.9 14.8c.9-1.6 2.1-2.4 3.3-2.4 1.2 0 2.4.8 3.2 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M11 14.8c.5-1 1.3-1.5 2.3-1.5s1.8.5 2.4 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("note")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M5 4h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 8.5h7M6.5 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("availability") || title.toLowerCase().includes("schedule")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("doctor")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="10" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 15.5c1-2 2.5-3 5-3s4 1 5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 2.5l2 2-2 2M16 4.5h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("search")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8.6" cy="8.6" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11.6 11.6 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 5.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("summary")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8h6M7 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("staff") || title.toLowerCase().includes("account")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 15c1.2-2 2.8-3 4.5-3s3.3 1 4.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 6v5M11.5 8.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DropdownSection(input: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <details
      open={input.defaultOpen}
      className="group rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-3"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#d6c9b4] bg-[#f8f1e4] text-[#6b5d47]">
            {input.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
              {input.title}
            </p>
            {input.subtitle && <p className="mt-0.5 text-[11px] text-[#85775d]">{input.subtitle}</p>}
          </div>
        </div>
        <span className="text-xs text-[#7f7057] transition-transform group-open:rotate-180">v</span>
      </summary>
      <div className="mt-3 border-t border-[#ebe1d1] pt-3">{input.children}</div>
    </details>
  );
}

function createSession(): ChatSession {
  return {
    id: createId("sess"),
    messages: [],
    pendingAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getEmptyConversation(): ConversationState {
  const session = createSession();
  return {
    activeSessionId: session.id,
    sessions: { [session.id]: session },
  };
}

function getActiveSession(conversation: ConversationState): ChatSession {
  return conversation.sessions[conversation.activeSessionId] ?? createSession();
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant" || value === "system";
}

function parseStoredFolders(raw: string | null): PatientFolder[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const id = toOptionalString(item.id);
      const name = toOptionalString(item.name);
      const patientId = toOptionalString(item.patientId);
      const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();

      if (!id || !name || !patientId) {
        return [];
      }

      return [{ id, name, patientId, createdAt }];
    });
  } catch {
    return [];
  }
}

function parseStoredConversations(raw: string | null): ConversationMap {
  if (!raw) {
    return {
      [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
      };
    }

    const output: ConversationMap = {};

    for (const [conversationId, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }

      // Migrate from old format (single conversation with messages/pendingAction)
      if (Array.isArray(value.messages)) {
        const messages: ChatMessage[] = value.messages.flatMap((item: unknown) => {
          if (!isRecord(item)) return [];
          const id = toOptionalString(item.id);
          const text = toOptionalString(item.text);
          const role = item.role;
          const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
          if (!id || !text || !isMessageRole(role)) return [];
          return [{ id, role, text, createdAt, raw: item.raw }];
        });

        let pendingAction: PendingActionState | null = null;
        if (isRecord(value.pendingAction)) {
          const pendingId = toOptionalString(value.pendingAction.id);
          if (pendingId) {
            pendingAction = {
              id: pendingId,
              expiresAt: toOptionalString(value.pendingAction.expiresAt),
              plannedToolCalls: sanitizeToolCalls(value.pendingAction.plannedToolCalls),
            };
          }
        }

        const sessionId = createId("sess");
        output[conversationId] = {
          activeSessionId: sessionId,
          sessions: {
            [sessionId]: {
              id: sessionId,
              messages,
              pendingAction,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        };
        continue;
      }

      // New format with sessions
      if (isRecord(value.sessions)) {
        const sessions: Record<string, ChatSession> = {};
        for (const [sessionId, sessionValue] of Object.entries(value.sessions)) {
          if (!isRecord(sessionValue)) continue;
          const rawMessages = Array.isArray(sessionValue.messages) ? sessionValue.messages : [];
          const messages: ChatMessage[] = rawMessages.flatMap((item: unknown) => {
            if (!isRecord(item)) return [];
            const id = toOptionalString(item.id);
            const text = toOptionalString(item.text);
            const role = item.role;
            const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
            if (!id || !text || !isMessageRole(role)) return [];
            return [{ id, role, text, createdAt, raw: item.raw }];
          });

          let pendingAction: PendingActionState | null = null;
          if (isRecord(sessionValue.pendingAction)) {
            const pendingId = toOptionalString(sessionValue.pendingAction.id);
            if (pendingId) {
              pendingAction = {
                id: pendingId,
                expiresAt: toOptionalString(sessionValue.pendingAction.expiresAt),
                plannedToolCalls: sanitizeToolCalls(sessionValue.pendingAction.plannedToolCalls),
              };
            }
          }

          sessions[sessionId] = {
            id: sessionId,
            messages,
            pendingAction,
            createdAt: typeof sessionValue.createdAt === "number" ? sessionValue.createdAt : Date.now(),
            updatedAt: typeof sessionValue.updatedAt === "number" ? sessionValue.updatedAt : Date.now(),
          };
        }

        const activeSessionId = toOptionalString(value.activeSessionId);
        const validSessionId = activeSessionId && sessions[activeSessionId] ? activeSessionId : Object.keys(sessions)[0] ?? createId("sess");

        if (!sessions[validSessionId]) {
          const newSession = createSession();
          sessions[newSession.id] = newSession;
          output[conversationId] = { activeSessionId: newSession.id, sessions };
        } else {
          output[conversationId] = { activeSessionId: validSessionId, sessions };
        }
        continue;
      }

      // Fallback: create empty
      output[conversationId] = getEmptyConversation();
    }

    if (!output[GLOBAL_CONVERSATION_ID]) {
      output[GLOBAL_CONVERSATION_ID] = getEmptyConversation();
    }

    return output;
  } catch {
    return {
      [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
    };
  }
}

function ensureConversation(map: ConversationMap, id: string | null): ChatSession {
  if (!id) {
    return getActiveSession(getEmptyConversation());
  }

  const conversation = map[id] ?? getEmptyConversation();
  return getActiveSession(conversation);
}

function getConversationKey(scope: ChatScope, activeFolderId: string | null): string | null {
  if (scope === "global") {
    return GLOBAL_CONVERSATION_ID;
  }

  return activeFolderId;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  });
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [bootstrapForm, setBootstrapForm] = useState({
    bootstrapKey: "",
    name: "",
    email: "",
    password: "",
  });
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const [chatScope, setChatScope] = useState<ChatScope>(() => {
    if (typeof window === "undefined") {
      return "global";
    }

    const stored = window.localStorage.getItem(CHAT_SCOPE_STORAGE_KEY);
    return stored === "patient" ? "patient" : "global";
  });

  const [folders, setFolders] = useState<PatientFolder[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    return parseStoredFolders(window.localStorage.getItem(PATIENT_FOLDERS_STORAGE_KEY));
  });

  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const parsedFolders = parseStoredFolders(
      window.localStorage.getItem(PATIENT_FOLDERS_STORAGE_KEY),
    );
    const stored = window.localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY);

    if (stored && parsedFolders.some((folder) => folder.id === stored)) {
      return stored;
    }

    return parsedFolders[0]?.id ?? null;
  });

  const [conversations, setConversations] = useState<ConversationMap>(() => {
    if (typeof window === "undefined") {
      return {
        [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
      };
    }

    return parseStoredConversations(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY));
  });

  const [promptMode, setPromptMode] = useState<PromptMode>("fetch");
  const [maxToolCalls, setMaxToolCalls] = useState(3);
  const [promptInput, setPromptInput] = useState("");

  const [showFolderForm, setShowFolderForm] = useState(false);
  const [newFolderForm, setNewFolderForm] = useState({
    name: "",
    patientId: "",
  });

  const [globalRagFiles, setGlobalRagFiles] = useState<File[]>([]);
  const [globalRagNote, setGlobalRagNote] = useState("");

  const [patientRagFiles, setPatientRagFiles] = useState<File[]>([]);
  const [patientRagPrompt, setPatientRagPrompt] = useState("");
  const [ragUploadMode, setRagUploadMode] = useState<RagUploadMode>("global");

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === activeFolderId) ?? null,
    [activeFolderId, folders],
  );

  const activeConversationKey = useMemo(
    () => getConversationKey(chatScope, activeFolderId),
    [chatScope, activeFolderId],
  );

  const activeConversation = useMemo(
    () => ensureConversation(conversations, activeConversationKey),
    [activeConversationKey, conversations],
  );

  const quickActions = useMemo(() => QUICK_ACTIONS, []);

  interface FolderStats {
    folderId: string;
    totalMessages: number;
    sessionCount: number;
    lastMessageAt: number | undefined;
    sessions: Array<{ id: string; messageCount: number; lastMessageAt: number | undefined; isActive: boolean }>;
  }

  const folderStats: FolderStats[] = useMemo(() => {
    return folders.map((folder) => {
      const conversation = conversations[folder.id] ?? getEmptyConversation();
      const sessionList = Object.values(conversation.sessions);
      let totalMessages = 0;
      let lastMessageAt: number | undefined;
      const sessions = sessionList.map((session) => {
        const msgCount = session.messages.length;
        totalMessages += msgCount;
        const last = session.messages[session.messages.length - 1];
        const lastAt = last?.createdAt;
        if (lastAt && (!lastMessageAt || lastAt > lastMessageAt)) {
          lastMessageAt = lastAt;
        }
        return {
          id: session.id,
          messageCount: msgCount,
          lastMessageAt: lastAt,
          isActive: session.id === conversation.activeSessionId,
        };
      });

      return {
        folderId: folder.id,
        totalMessages,
        sessionCount: sessionList.length,
        lastMessageAt,
        sessions,
      };
    });
  }, [conversations, folders]);

  const appendMessageToConversation = useCallback(
    (conversationId: string | null, message: Omit<ChatMessage, "id" | "createdAt">) => {
      if (!conversationId) {
        return;
      }

      setConversations((current) => {
        const conversation = current[conversationId] ?? getEmptyConversation();
        const session = conversation.sessions[conversation.activeSessionId] ?? createSession();
        const newMessage: ChatMessage = { ...message, id: createId("msg"), createdAt: Date.now() };

        return {
          ...current,
          [conversationId]: {
            ...conversation,
            sessions: {
              ...conversation.sessions,
              [session.id]: {
                ...session,
                messages: [...session.messages, newMessage],
                updatedAt: Date.now(),
              },
            },
          },
        };
      });
    },
    [],
  );

  const setPendingActionForConversation = useCallback(
    (conversationId: string | null, pendingAction: PendingActionState | null) => {
      if (!conversationId) {
        return;
      }

      setConversations((current) => {
        const conversation = current[conversationId] ?? getEmptyConversation();
        const session = conversation.sessions[conversation.activeSessionId] ?? createSession();

        return {
          ...current,
          [conversationId]: {
            ...conversation,
            sessions: {
              ...conversation.sessions,
              [session.id]: {
                ...session,
                pendingAction,
                updatedAt: Date.now(),
              },
            },
          },
        };
      });
    },
    [],
  );

  const clearConversation = useCallback((conversationId: string | null) => {
    if (!conversationId) {
      return;
    }

    setConversations((current) => {
      const conversation = current[conversationId] ?? getEmptyConversation();
      const newSession = createSession();

      return {
        ...current,
        [conversationId]: {
          ...conversation,
          activeSessionId: newSession.id,
          sessions: {
            ...conversation.sessions,
            [newSession.id]: newSession,
          },
        },
      };
    });
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setPromptInput("");
    setFeedback(null);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, []);

  const apiRequest = useCallback(
    async <T,>(
      path: string,
      options?: RequestInit & {
        idempotencyKey?: string;
      },
    ): Promise<T> => {
      const headers = new Headers(options?.headers ?? {});

      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const isFormDataBody =
        typeof FormData !== "undefined" && options?.body instanceof FormData;

      if (options?.body && !isFormDataBody && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      if (options?.idempotencyKey) {
        headers.set("Idempotency-Key", options.idempotencyKey);
      }

      const requestMethod = options?.method ?? "GET";
      const requestUrl = buildApiUrl(path);

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          ...options,
          headers,
          credentials: "include",
          cache: "no-store",
        });
      } catch (error) {
        throw new Error(
          `Network error for ${requestMethod} ${requestUrl}: ${extractErrorMessage(error)}`,
        );
      }

      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

      if (!response.ok) {
        if (response.status === 401 && token) {
          clearSession();
        }

        const baseMessage =
          formatApiErrorMessage(payload) ??
          payload?.message ??
          `Request failed with status ${response.status}`;

        throw new Error(`${baseMessage} | HTTP ${response.status} ${requestMethod} ${requestUrl}`);
      }

      if (!payload) {
        throw new Error(`Empty API response for ${requestMethod} ${requestUrl}`);
      }

      return payload.data;
    },
    [clearSession, token],
  );

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const user = await apiRequest<AuthUser>("/auth/me");
      setCurrentUser(user);
    } catch (error) {
      clearSession();
      setFeedback(extractErrorMessage(error));
    }
  }, [apiRequest, clearSession, token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!token) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }, [token]);

  useEffect(() => {
    if (!token || typeof window === "undefined") {
      return;
    }

    const timerId = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [loadCurrentUser, token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CHAT_SCOPE_STORAGE_KEY, chatScope);
  }, [chatScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PATIENT_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!activeFolderId) {
      window.localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, activeFolderId);
  }, [activeFolderId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [activeConversation.messages]);

  const handleBootstrapAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      await apiRequest<AuthUser>("/auth/bootstrap-admin", {
        method: "POST",
        body: JSON.stringify(bootstrapForm),
      });

      setFeedback("Admin created successfully. You can now log in.");
      setBootstrapForm({ bootstrapKey: "", name: "", email: "", password: "" });
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });

      setToken(result.accessToken);
      setCurrentUser(result.user);
      setLoginForm({ email: "", password: "" });
      setFeedback("Welcome back.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);

    try {
      await apiRequest<null>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore logout errors and clear local session anyway.
    } finally {
      clearSession();
      setBusy(false);
    }
  };

  const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = newFolderForm.name.trim();
    const patientId = newFolderForm.patientId.trim();

    if (!name) {
      setFeedback("Folder name is required.");
      return;
    }

    if (!patientId) {
      setFeedback("Patient ID is required.");
      return;
    }

    if (!/^[a-fA-F0-9]{24}$/.test(patientId)) {
      setFeedback("Patient ID must be a valid 24-character MongoDB ObjectId.");
      return;
    }

    const duplicate = folders.find((folder) => folder.patientId === patientId);
    if (duplicate) {
      setActiveFolderId(duplicate.id);
      setChatScope("patient");
      setFeedback("This patient already has a folder. Switched to it.");
      return;
    }

    const created: PatientFolder = {
      id: createId("folder"),
      name,
      patientId,
      createdAt: Date.now(),
    };

    setFolders((current) => [created, ...current]);
    setConversations((current) => ({
      ...current,
      [created.id]: getEmptyConversation(),
    }));
    setActiveFolderId(created.id);
    setChatScope("patient");
    setShowFolderForm(false);
    setNewFolderForm({ name: "", patientId: "" });
    setFeedback("Patient folder created.");
  };

  const handleDeleteFolder = (folderId: string) => {
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete folder '${folder.name}' and its chat history? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
    }

    const remainingFolders = folders.filter((entry) => entry.id !== folderId);

    setFolders(remainingFolders);
    setConversations((current) => {
      const next = { ...current };
      delete next[folderId];
      return next;
    });

    if (activeFolderId === folderId) {
      const nextActiveId = remainingFolders[0]?.id ?? null;
      setActiveFolderId(nextActiveId);
      if (!nextActiveId) {
        setChatScope("global");
      }
    }

    setFeedback("Folder deleted.");
  };

  const handleDeleteSession = (folderId: string, sessionId: string) => {
    setConversations((current) => {
      const conversation = current[folderId];
      if (!conversation || !conversation.sessions[sessionId]) {
        return current;
      }

      const remaining = Object.keys(conversation.sessions).filter((id) => id !== sessionId);
      if (remaining.length === 0) {
        return current;
      }

      const newSessions: Record<string, ChatSession> = {};
      for (const id of remaining) {
        newSessions[id] = conversation.sessions[id];
      }

      const wasActive = conversation.activeSessionId === sessionId;
      return {
        ...current,
        [folderId]: {
          ...conversation,
          activeSessionId: wasActive ? remaining[remaining.length - 1] : conversation.activeSessionId,
          sessions: newSessions,
        },
      };
    });
  };

  const handleSwitchSession = (folderId: string, sessionId: string) => {
    setConversations((current) => {
      const conversation = current[folderId];
      if (!conversation || !conversation.sessions[sessionId]) {
        return current;
      }
      return {
        ...current,
        [folderId]: {
          ...conversation,
          activeSessionId: sessionId,
        },
      };
    });
  };

  const handleNewChat = () => {
    if (!activeConversationKey) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    clearConversation(activeConversationKey);
    setPromptInput("");
    setFeedback("Started a new session. Previous sessions are preserved.");
  };

  const handleQuickAction = (action: { mode: PromptMode; prompt: string }) => {
    setPromptMode(action.mode);

    if (chatScope === "patient") {
      if (!activeFolder) {
        setFeedback("Create or select a patient folder first.");
        return;
      }

      setPromptInput(action.prompt.replaceAll("<PATIENT_ID>", activeFolder.patientId));
      return;
    }

    const withoutPatientPlaceholder = action.prompt.replaceAll("<PATIENT_ID>", "the relevant patient");
    setPromptInput(withoutPatientPlaceholder);
  };

  const executePrompt = async () => {
    if (!activeConversationKey) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    if (chatScope === "patient" && !activeFolder) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    const trimmed = promptInput.trim();
    if (!trimmed) {
      setFeedback("Type a message first.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    appendMessageToConversation(activeConversationKey, {
      role: "user",
      text: trimmed,
    });

    try {
      const payloadPrompt = buildPromptWithMode({
        mode: promptMode,
        prompt: trimmed,
        scope: chatScope,
        folder: activeFolder ?? undefined,
      });

      const conversation = ensureConversation(conversations, activeConversationKey);
      const history = conversation.messages
        .slice(0, -1)
        .map((msg: ChatMessage) => ({ role: msg.role, text: msg.text }));

      const result = await apiRequest<AgentExecutionResult>("/agent/execute", {
        method: "POST",
        body: JSON.stringify({
          prompt: payloadPrompt,
          maxToolCalls,
          history,
        }),
        idempotencyKey: createId("agent-execute"),
      });

      const plannedToolCalls = sanitizeToolCalls(result.plannedToolCalls);
      setPendingActionForConversation(
        activeConversationKey,
        result.requiresConfirmation && result.pendingActionId
          ? {
              id: result.pendingActionId,
              expiresAt: result.expiresAt,
              plannedToolCalls,
            }
          : null,
      );

      appendMessageToConversation(activeConversationKey, {
        role: "assistant",
        text: summarizeExecutionResult(result),
        raw: result,
      });

      setPromptInput("");
    } catch (error) {
      appendMessageToConversation(activeConversationKey, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await executePrompt();
  };

  const handleConfirmPendingAction = async (approved: boolean) => {
    if (!activeConversationKey) {
      setFeedback("No active conversation context.");
      return;
    }

    const pendingAction = ensureConversation(conversations, activeConversationKey).pendingAction;
    if (!pendingAction) {
      setFeedback("No pending action in this context.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const result = await apiRequest<AgentConfirmResult>(`/agent/actions/${pendingAction.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ approved }),
        idempotencyKey: createId("agent-confirm"),
      });

      appendMessageToConversation(activeConversationKey, {
        role: approved ? "assistant" : "system",
        text: summarizeConfirmResult(result),
        raw: result,
      });

      setPendingActionForConversation(activeConversationKey, null);
    } catch (error) {
      appendMessageToConversation(activeConversationKey, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUploadGlobalRag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (currentUser?.role !== "admin") {
      setFeedback("Global RAG upload is restricted to admin.");
      return;
    }

    if (globalRagFiles.length === 0) {
      setFeedback("Select at least one global RAG file.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      if (globalRagNote.trim()) {
        formData.append("note", globalRagNote.trim());
      }

      globalRagFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await apiRequest<unknown>("/ai/global/upload", {
        method: "POST",
        body: formData,
      });

      appendMessageToConversation(GLOBAL_CONVERSATION_ID, {
        role: "assistant",
        text: `Indexed ${globalRagFiles.length} global RAG file(s) successfully.`,
        raw: result,
      });

      setGlobalRagFiles([]);
      setGlobalRagNote("");
      setFeedback("Global RAG upload completed.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
      appendMessageToConversation(GLOBAL_CONVERSATION_ID, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUploadPatientRag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeFolder) {
      setFeedback("Select a patient folder first.");
      return;
    }

    if (patientRagFiles.length === 0) {
      setFeedback("Select at least one patient RAG file.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append("patientId", activeFolder.patientId);
      formData.append("mode", "rag");

      if (patientRagPrompt.trim()) {
        formData.append("prompt", patientRagPrompt.trim());
      }

      patientRagFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await apiRequest<unknown>("/ai/records/upload", {
        method: "POST",
        body: formData,
      });

      appendMessageToConversation(activeFolder.id, {
        role: "assistant",
        text: `Indexed ${patientRagFiles.length} patient RAG file(s) for ${activeFolder.name}.`,
        raw: result,
      });

      setPatientRagFiles([]);
      setPatientRagPrompt("");
      setFeedback("Patient RAG upload completed.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
      appendMessageToConversation(activeFolder.id, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f1e8] px-4 py-8 text-[#2f2a21] sm:px-8">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="rounded-3xl border border-[#e0d7c8] bg-[#fbf8f1] p-8 shadow-[0_12px_30px_rgba(0,0,0,0.06)]">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d6a4e]">MediAssist IA</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-[#2f2a21]">
              Global + Patient RAG workspace
            </h1>
            <p className="mt-4 max-w-xl text-sm text-[#645841] sm:text-base">
              Chat globally with AI, or switch to a specific patient folder context with its own
              isolated history and patient-scoped RAG.
            </p>
            <div className="mt-8 rounded-2xl border border-[#e7ddcd] bg-white/70 p-4 text-sm text-[#5f513a]">
              API base: <span className="font-medium">{API_BASE_URL}</span>
            </div>
          </section>

          <section className="rounded-3xl border border-[#e0d7c8] bg-[#fbf8f1] p-6 shadow-[0_12px_30px_rgba(0,0,0,0.06)]">
            <div className="grid gap-6">
              <form className="grid gap-3" onSubmit={handleBootstrapAdmin}>
                <h2 className="text-xl font-semibold text-[#2f2a21]">Bootstrap Admin</h2>
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Bootstrap key"
                  value={bootstrapForm.bootstrapKey}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, bootstrapKey: event.target.value }))
                  }
                  required
                />
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Full name"
                  value={bootstrapForm.name}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Email"
                  type="email"
                  value={bootstrapForm.email}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                />
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Password"
                  type="password"
                  value={bootstrapForm.password}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#2f2a21] px-4 py-2 text-sm font-medium text-[#f8f4ec]"
                  disabled={busy}
                >
                  {busy ? "Processing..." : "Create Admin"}
                </button>
              </form>

              <form className="grid gap-3" onSubmit={handleLogin}>
                <h2 className="text-xl font-semibold text-[#2f2a21]">Login</h2>
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Email"
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                />
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  placeholder="Password"
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#0f5a4f] px-4 py-2 text-sm font-medium text-white"
                  disabled={busy}
                >
                  {busy ? "Signing in..." : "Login"}
                </button>
              </form>

              {feedback && (
                <p className="rounded-xl border border-[#e3d8c6] bg-[#fffdf8] px-3 py-2 text-sm text-[#6e5b40]">
                  {feedback}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const activePendingAction = activeConversation.pendingAction;
  const canSendPrompt = chatScope === "global" || (chatScope === "patient" && Boolean(activeFolder));

  return (
    <div className="h-screen overflow-hidden bg-[#f5f1e8] p-3 text-[#2f2a21]">
      <div className="mx-auto flex h-full max-w-[1760px] flex-col gap-3 lg:flex-row">
        <aside className="flex max-h-[46vh] w-full shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-[#ddd2bf] bg-[#f7f2e8] p-2 shadow-[0_6px_18px_rgba(0,0,0,0.05)] lg:max-h-none lg:w-[360px]">
          <div className="rounded-xl border border-[#d8ccb6] bg-[#fffaf1] px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#8a7c62]">Workspace</p>
            <p className="mt-1 text-xs text-[#655842]">
              Active scope: <span className="font-semibold">{chatScope === "global" ? "Global" : "Patient"}</span>
            </p>
            <p className="text-[11px] text-[#81745b]">
              {chatScope === "patient" && activeFolder
                ? `${activeFolder.name} (${activeFolder.patientId})`
                : "Shared global context"}
            </p>
          </div>

          {DropdownSection({
            title: "Chat Scope",
            subtitle: "Switch context and manage patient chat folders",
            icon: ScopeIcon(),
            defaultOpen: true,
            children: (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setChatScope("global")}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                      chatScope === "global"
                        ? "bg-[#2f2a21] text-[#f8f4ec]"
                        : "border border-[#d2c6b1] bg-[#f7f0e4] text-[#665a44]"
                    }`}
                  >
                    Global Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatScope("patient")}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                      chatScope === "patient"
                        ? "bg-[#2f2a21] text-[#f8f4ec]"
                        : "border border-[#d2c6b1] bg-[#f7f0e4] text-[#665a44]"
                    }`}
                  >
                    Patient Chat
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="mt-2 w-full rounded-lg border border-[#cfc2ab] bg-[#fbf7ef] px-3 py-2 text-left text-xs font-medium hover:bg-[#fffaf3]"
                >
                  + New Chat In Current Scope
                </button>

                {chatScope === "global" && (() => {
                  const globalConv = conversations[GLOBAL_CONVERSATION_ID];
                  const globalSessions = globalConv ? Object.values(globalConv.sessions) : [];
                  return globalSessions.length > 1 ? (
                    <div className="mt-2 rounded-lg border border-[#d9ceb9] bg-[#faf6ee] px-2 py-2">
                      <details>
                        <summary className="cursor-pointer text-[10px] text-[#7c6e55]">
                          Global Sessions ({globalSessions.length})
                        </summary>
                        <div className="mt-1 space-y-1">
                          {globalSessions.map((session) => (
                            <div key={session.id} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSwitchSession(GLOBAL_CONVERSATION_ID, session.id)}
                                className={`flex-1 rounded px-2 py-1 text-left text-[10px] ${
                                  session.id === globalConv?.activeSessionId
                                    ? "bg-[#e0d5c0] font-semibold text-[#2f2a21]"
                                    : "text-[#6a5b43] hover:bg-[#efeadc]"
                                }`}
                              >
                                {session.messages.length} msg{session.messages.length !== 1 ? "s" : ""}
                                {session.messages.length > 0
                                  ? ` | ${formatDateTime(session.messages[session.messages.length - 1].createdAt)}`
                                  : " | empty"}
                                {session.id === globalConv?.activeSessionId ? " (active)" : ""}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(GLOBAL_CONVERSATION_ID, session.id)}
                                className="rounded px-1 py-1 text-[10px] text-[#7f3f3f] hover:bg-[#fff1ef]"
                                title="Delete session"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : null;
                })()}

                {chatScope === "patient" && (
                  <>
                    <div className="mt-3 rounded-lg border border-[#dacfbf] bg-[#fffdf7] p-2">
                      <button
                        type="button"
                        onClick={() => setShowFolderForm((current) => !current)}
                        className="w-full rounded-md border border-[#d2c6b1] px-2 py-2 text-[11px] font-medium text-[#6a5b43] hover:bg-[#fff8ed]"
                      >
                        {showFolderForm ? "Hide Create Form" : "Create Patient Folder"}
                      </button>

                      {showFolderForm && (
                        <form className="mt-2 grid gap-2" onSubmit={handleCreateFolder}>
                          <input
                            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                            placeholder="Folder name"
                            value={newFolderForm.name}
                            onChange={(event) =>
                              setNewFolderForm((current) => ({ ...current, name: event.target.value }))
                            }
                            required
                          />
                          <input
                            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                            placeholder="Patient ID (ObjectId)"
                            value={newFolderForm.patientId}
                            onChange={(event) =>
                              setNewFolderForm((current) => ({ ...current, patientId: event.target.value }))
                            }
                            required
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-[#2f2a21] px-3 py-2 text-xs font-semibold text-[#f8f4ec]"
                          >
                            Create Folder
                          </button>
                        </form>
                      )}
                    </div>

                    <div className="mt-2 max-h-[250px] space-y-2 overflow-y-auto pr-1">
                      {folders.length === 0 && (
                        <p className="rounded-lg border border-dashed border-[#d8ccb6] px-2 py-2 text-xs text-[#8a7c62]">
                          No patient folders yet.
                        </p>
                      )}

                      {folders.map((folder) => {
                        const stats = folderStats.find((entry) => entry.folderId === folder.id);
                        const isActive = folder.id === activeFolderId;

                        return (
                          <div
                            key={folder.id}
                            className={`rounded-lg border px-2 py-2 ${
                              isActive
                                ? "border-[#baab8f] bg-[#fff8ed]"
                                : "border-[#d9ceb9] bg-[#faf6ee]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFolderId(folder.id);
                                setChatScope("patient");
                              }}
                              className="w-full text-left"
                            >
                              <p className="text-xs font-semibold text-[#3c3327]">{folder.name}</p>
                              <p className="mt-1 break-all text-[10px] text-[#7c6e55]">{folder.patientId}</p>
                              <p className="mt-1 text-[10px] text-[#8e7f63]">
                                {stats?.totalMessages ?? 0} messages across {stats?.sessionCount ?? 1} session(s)
                                {stats?.lastMessageAt ? ` | ${formatDateTime(stats.lastMessageAt)}` : ""}
                              </p>
                            </button>

                            {stats && stats.sessions.length > 1 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-[10px] text-[#7c6e55]">
                                  Sessions ({stats.sessions.length})
                                </summary>
                                <div className="mt-1 space-y-1">
                                  {stats.sessions.map((session) => (
                                    <div
                                      key={session.id}
                                      className="flex items-center gap-1"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveFolderId(folder.id);
                                          setChatScope("patient");
                                          handleSwitchSession(folder.id, session.id);
                                        }}
                                        className={`flex-1 rounded px-2 py-1 text-left text-[10px] ${
                                          session.isActive
                                            ? "bg-[#e0d5c0] font-semibold text-[#2f2a21]"
                                            : "text-[#6a5b43] hover:bg-[#efeadc]"
                                        }`}
                                      >
                                        {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
                                        {session.lastMessageAt
                                          ? ` | ${formatDateTime(session.lastMessageAt)}`
                                          : " | empty"}
                                        {session.isActive ? " (active)" : ""}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSession(folder.id, session.id)}
                                        className="rounded px-1 py-1 text-[10px] text-[#7f3f3f] hover:bg-[#fff1ef]"
                                        title="Delete session"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(folder.id)}
                              className="mt-1 rounded-md border border-[#d6c8b1] px-2 py-1 text-[10px] font-medium text-[#7f3f3f] hover:bg-[#fff1ef]"
                            >
                              Delete
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            ),
          })}

          {DropdownSection({
            title: "Calendar",
            subtitle: "Manage appointments",
            icon: CalendarIcon(),
            defaultOpen: false,
            children: (
              <Calendar token={token} />
            ),
          })}

          {DropdownSection({
            title: "RAG Upload",
            subtitle: "Switch between global and patient uploads",
            icon: UploadIcon(),
            children: (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  if (ragUploadMode === "global") {
                    void handleUploadGlobalRag(event);
                    return;
                  }

                  void handleUploadPatientRag(event);
                }}
              >
                <div className="inline-flex rounded-lg border border-[#d2c6b1] bg-[#f6f0e4] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setRagUploadMode("global")}
                    className={`rounded-md px-2 py-1 ${
                      ragUploadMode === "global" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                    }`}
                  >
                    Global
                  </button>
                  <button
                    type="button"
                    onClick={() => setRagUploadMode("patient")}
                    className={`rounded-md px-2 py-1 ${
                      ragUploadMode === "patient" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                    }`}
                  >
                    Patient
                  </button>
                </div>

                {ragUploadMode === "patient" && (
                  <div className="rounded-lg border border-[#d7ccb8] bg-[#fffdf8] px-2 py-2 text-[11px] text-[#615338]">
                    Active patient: {activeFolder ? `${activeFolder.name} (${activeFolder.patientId})` : "None"}
                  </div>
                )}

                <textarea
                  className="min-h-[56px] rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                  placeholder={
                    ragUploadMode === "global" ? "Optional note" : "Optional prompt for parsing context"
                  }
                  value={ragUploadMode === "global" ? globalRagNote : patientRagPrompt}
                  onChange={(event) => {
                    if (ragUploadMode === "global") {
                      setGlobalRagNote(event.target.value);
                      return;
                    }

                    setPatientRagPrompt(event.target.value);
                  }}
                  disabled={ragUploadMode === "patient" && !activeFolder}
                />

                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    if (ragUploadMode === "global") {
                      setGlobalRagFiles(Array.from(event.target.files ?? []));
                      return;
                    }

                    setPatientRagFiles(Array.from(event.target.files ?? []));
                  }}
                  className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                  disabled={ragUploadMode === "patient" && !activeFolder}
                />

                <button
                  type="submit"
                  className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                    ragUploadMode === "global" ? "bg-[#0f5a4f]" : "bg-[#1c4f8c]"
                  }`}
                  disabled={
                    busy ||
                    (ragUploadMode === "global" ? currentUser.role !== "admin" : !activeFolder)
                  }
                >
                  {busy
                    ? "Uploading..."
                    : ragUploadMode === "global"
                      ? "Upload Global RAG"
                      : "Upload Patient RAG"}
                </button>

                {ragUploadMode === "global" && currentUser.role !== "admin" && (
                  <p className="text-[11px] text-[#8d6b35]">Only admin can upload global knowledge.</p>
                )}
              </form>
            ),
          })}

          {DropdownSection({
            title: "Account",
            subtitle: "Profile and session",
            icon: UserIcon(),
            defaultOpen: true,
            children: (
              <>
                <p className="text-sm font-semibold text-[#352d21]">{currentUser.name}</p>
                <p className="mt-1 text-xs text-[#7e7058]">{currentUser.email}</p>
                <span
                  className={`mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-semibold ${roleBadgeClass(
                    currentUser.role,
                  )}`}
                >
                  {currentUser.role}
                </span>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="mt-3 w-full rounded-lg border border-[#cdbfa8] px-3 py-2 text-xs font-medium hover:bg-[#f7efe1]"
                  disabled={busy}
                >
                  Logout
                </button>
              </>
            ),
          })}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[#ddd2bf] bg-[#faf7f0] shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2d8c7] px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[#8e7f63]">MediAssist Conversation</p>
              <h1 className="text-lg font-semibold text-[#2f2a21]">
                {chatScope === "global" ? "Global AI Chat" : "Patient Folder AI Chat"}
              </h1>
              {chatScope === "global" ? (
                <p className="mt-1 text-xs text-[#6f6148]">Using Global Knowledge RAG by default.</p>
              ) : activeFolder ? (
                <p className="mt-1 text-xs text-[#6f6148]">
                  Folder: <span className="font-semibold">{activeFolder.name}</span> | Patient ID: {" "}
                  <span className="font-semibold">{activeFolder.patientId}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-[#8c6a38]">
                  Select a patient folder to use patient-scoped context.
                </p>
              )}
            </div>
          </header>

          {feedback && (
            <div className="border-b border-[#eadfce] bg-[#fff9ee] px-4 py-2 text-sm text-[#745f3e]">{feedback}</div>
          )}

          <div ref={chatContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {activeConversation.messages.length === 0 && (
              <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-[#dfd3bf] bg-white/80 p-6 text-center">
                <h2 className="text-2xl font-semibold text-[#2f2a21]">
                  {chatScope === "global"
                    ? "Ask using global context"
                    : activeFolder
                      ? `Ask about ${activeFolder.name}`
                      : "Select a patient folder first"}
                </h2>
                <p className="mt-2 text-sm text-[#6f6148]">
                  {chatScope === "global"
                    ? "This chat uses Global RAG knowledge by default."
                    : activeFolder
                      ? "This chat uses patient RAG first, then falls back to global RAG when needed."
                      : "Create or choose a patient folder in the left panel to continue."}
                </p>
              </div>
            )}

            {activeConversation.messages.map((message) => (
              <article key={message.id} className="space-y-2">
                <div className={messageBubbleClass(message.role)}>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                </div>
                <div className="px-1 text-[11px] text-[#8f8167]">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </div>
                {message.raw !== undefined && (
                  <details className="rounded-xl border border-[#e4dac9] bg-[#fffdf9] p-2 text-xs text-[#5f523d]">
                    <summary className="cursor-pointer select-none">Technical details (JSON)</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(message.raw, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            ))}
          </div>

          {activePendingAction && (
            <div className="border-t border-[#e3d8c8] bg-[#fff6e6] px-4 py-3">
              <p className="text-sm font-medium text-[#6f4a00]">Pending destructive action</p>
              <p className="mt-1 text-xs text-[#7d6440]">
                ID: {activePendingAction.id}
                {activePendingAction.expiresAt
                  ? ` | Expires: ${formatDateTime(activePendingAction.expiresAt)}`
                  : ""}
              </p>
              {activePendingAction.plannedToolCalls.length > 0 && (
                <p className="mt-1 text-xs text-[#7d6440]">
                  Planned tools: {activePendingAction.plannedToolCalls.map((call) => call.tool).join(", ")}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmPendingAction(true)}
                  className="rounded-lg bg-[#166534] px-3 py-2 text-xs font-semibold text-white"
                  disabled={busy}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPendingAction(false)}
                  className="rounded-lg bg-[#8a1c1c] px-3 py-2 text-xs font-semibold text-white"
                  disabled={busy}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <footer className="border-t border-[#e2d8c7] p-2 sm:p-2.5">
            <form className="space-y-2" onSubmit={handleSendPrompt}>
              <div className="relative rounded-2xl border border-[#d6cab5] bg-white p-2.5 shadow-[0_4px_10px_rgba(0,0,0,0.04)]">
                <textarea
                  value={promptInput}
                  onChange={(event) => setPromptInput(event.target.value)}
                  placeholder={
                    chatScope === "global"
                      ? "Message MediAssist globally..."
                      : activeFolder
                        ? `Message MediAssist for ${activeFolder.name}...`
                        : "Select a patient folder first..."
                  }
                  className="min-h-[52px] w-full resize-y border-0 bg-transparent text-sm leading-6 text-[#2f2a21] outline-none"
                  disabled={!canSendPrompt}
                />

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#eee6d8] pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <details className="group relative">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-[#d9ceb9] bg-[#faf6ee] text-[#6c5e47] hover:bg-white [&::-webkit-details-marker]:hidden">
                        {ControlsIcon()}
                        <span className="sr-only">Open main controls</span>
                      </summary>
                      <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[270px] rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.08)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
                          Main Controls
                        </p>
                        <div className="mt-2 inline-flex rounded-lg border border-[#d2c6b1] bg-[#f6f0e4] p-0.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setPromptMode("fetch")}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                              promptMode === "fetch" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                            }`}
                          >
                            {FetchIcon()}
                            Fetch
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptMode("insert")}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                              promptMode === "insert" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                            }`}
                          >
                            {InsertIcon()}
                            Insert
                          </button>
                        </div>
                        <label className="mt-2 inline-flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7e7058]">
                          {ToolLimitIcon()}
                          Tool Calls
                          <select
                            value={maxToolCalls}
                            onChange={(event) => setMaxToolCalls(Number(event.target.value))}
                            className="ml-auto rounded-md border border-[#d4c8b3] bg-white px-2 py-1 text-[11px] text-[#2f2a21]"
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                            <option value={5}>5</option>
                          </select>
                        </label>
                      </div>
                    </details>

                    <details className="group relative">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-[#d9ceb9] bg-[#faf6ee] text-[#6c5e47] hover:bg-white [&::-webkit-details-marker]:hidden">
                        {QuickActionsIcon()}
                        <span className="sr-only">Open quick actions</span>
                      </summary>
                      <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[min(78vw,380px)] rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.08)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
                          Quick Actions
                        </p>
                        <div className="mt-2 flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {quickActions.map((item) => (
                            <button
                              key={item.title}
                              type="button"
                              onClick={() => handleQuickAction(item)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#d9ceb9] bg-[#faf6ee] px-2 py-1 text-[11px] font-medium text-[#5f523d] hover:bg-white"
                            >
                              <span className="text-[#6f6148]">{quickActionIcon(item.title)}</span>
                              {item.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="rounded-lg border border-[#d5c8b2] px-3 py-1.5 text-xs font-medium text-[#5f523d] hover:bg-[#f9f3e8]"
                      disabled={!canSendPrompt}
                    >
                      Clear Current Chat
                    </button>

                    <button
                      type="submit"
                      className="rounded-xl bg-[#2f2a21] px-4 py-1.5 text-sm font-medium text-[#f8f5ef] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy || !canSendPrompt}
                    >
                      {busy ? "Working..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </footer>
        </section>
      </div>
    </div>
  );
}
