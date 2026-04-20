"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type UserRole = "admin" | "doctor" | "nurse" | "secretary";
type FeedbackType = "success" | "error" | "info";
type PromptMode = "fetch" | "insert";
type AIRecordMode = "non_rag" | "rag";
type HistoryKind = "prompt" | "result" | "system";
type EntityType = "patient" | "doctor" | "appointment";
type ContextItemKind = "history" | "entity" | "pending";
type ContextPreset = "full" | "history-only" | "entities-only" | "pending-only" | "custom";

type Nullable<T> = T | null;

interface ApiEnvelope<T> {
  message: string;
  data: T;
  details?: unknown;
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
  results?: unknown;
}

interface ToolExecutionResultItem {
  tool: string;
  args?: unknown;
  result?: unknown;
}

interface AgentConfirmResult {
  pendingActionId: string;
  status: "rejected" | "executed";
  message: string;
  results?: unknown;
}

interface Feedback {
  type: FeedbackType;
  message: string;
}

interface HistoryItem {
  id: string;
  kind: HistoryKind;
  title: string;
  text: string;
  payload?: unknown;
  createdAt: number;
}

interface PendingActionState {
  id: string;
  expiresAt?: string;
  plannedToolCalls: AgentToolCall[];
}

interface EntityReference {
  type: EntityType;
  id: string;
  label: string;
  hint?: string;
}

interface QuickPrompt {
  title: string;
  mode: PromptMode;
  prompt: string;
}

interface ConversationContextItem {
  key: string;
  kind: ContextItemKind;
  label: string;
  line: string;
}

interface ConversationContextPack {
  text: string;
  historyLines: string[];
  entityLines: string[];
  pendingLine?: string;
  items: ConversationContextItem[];
  includedCount: number;
  totalCount: number;
}

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";
const TOKEN_STORAGE_KEY = "mediassist_access_token";
const MAX_HISTORY_ITEMS = 50;
const MAX_ENTITY_MEMORY = 24;
const MAX_CONTEXT_HISTORY_ITEMS = 8;
const MAX_CONTEXT_ENTITY_ITEMS = 10;
const MAX_CONTEXT_CHARACTERS = 3800;

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

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function formatApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const baseMessage = typeof payload.message === "string" ? payload.message : null;
  const issues = payload.issues;

  if (!isRecord(issues) || !isRecord(issues.fieldErrors)) {
    return baseMessage;
  }

  const fieldEntries: string[] = [];

  Object.entries(issues.fieldErrors).forEach(([field, value]) => {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    const firstMessage = value.find((item) => typeof item === "string");
    if (typeof firstMessage === "string") {
      fieldEntries.push(`${field}: ${firstMessage}`);
    }
  });

  if (fieldEntries.length === 0) {
    return baseMessage;
  }

  const prefix = baseMessage ?? "Validation error";
  return `${prefix} | ${fieldEntries.join(" | ")}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function rolePillClass(role: UserRole): string {
  switch (role) {
    case "admin":
      return "pill bg-[#fef7e6] text-[#7a4f07]";
    case "doctor":
      return "pill bg-[#ecf9ff] text-[#0f4f80]";
    case "nurse":
      return "pill bg-[#ecfdf3] text-[#176742]";
    case "secretary":
      return "pill bg-[#f4f0ff] text-[#5636a1]";
    default:
      return "pill";
  }
}

function historyBadgeClass(kind: HistoryKind): string {
  if (kind === "prompt") {
    return "pill bg-[#edf7ff] text-[#1a56a8]";
  }

  if (kind === "result") {
    return "pill bg-[#ecfdf3] text-[#176742]";
  }

  return "pill bg-[#fff4e8] text-[#9a4f00]";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "<non-serializable payload>";
  }
}

function parseToolExecutionItems(value: unknown): ToolExecutionResultItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: ToolExecutionResultItem[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.tool !== "string") {
      continue;
    }

    items.push({
      tool: candidate.tool,
      args: candidate.args,
      result: candidate.result,
    });
  }

  return items;
}

function normalizeMedicationLine(line: string): string {
  return line
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/\*\*/g, "")
    .replace(/^new medication:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\.\.$/, "")
    .trim();
}

function isLikelyMedicationLine(line: string): boolean {
  const lowered = line.toLowerCase();

  if (!lowered || lowered === "medications:") {
    return false;
  }

  if (lowered.includes("medication change")) {
    return false;
  }

  const hasDose = /\b\d+(?:\.\d+)?\s?(mg|mcg|g|ml)\b/i.test(line);
  const hasSchedule =
    /\b(po|iv|im|bid|tid|qid|q\d+h|qhs|prn|daily|weekly|with meals)\b/i.test(lowered);
  const hasMedicationVerb = /\b(start|stop|discontinue|take|takes|using|use)\b/i.test(lowered);

  return hasDose && (hasSchedule || hasMedicationVerb);
}

function extractMedicationLinesFromMatches(matches: unknown): string[] {
  if (!Array.isArray(matches)) {
    return [];
  }

  const extracted = new Set<string>();

  for (const candidate of matches) {
    if (!isRecord(candidate) || typeof candidate.content !== "string") {
      continue;
    }

    const lines = candidate.content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = normalizeMedicationLine(rawLine);
      if (!line || line.length < 6) {
        continue;
      }

      if (!isLikelyMedicationLine(line)) {
        continue;
      }

      extracted.add(line);
    }
  }

  return Array.from(extracted);
}

function isMedicationQuestion(prompt: string): boolean {
  return /\b(medication|medications|medicine|medicines|drug|drugs|prescription|takes|taking)\b/i.test(
    prompt,
  );
}

function humanizeToolName(toolName: string): string {
  return toolName.replaceAll("_", " ").trim();
}

function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderPatientLabel(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const firstName = typeof value.firstName === "string" ? value.firstName.trim() : "";
  const lastName = typeof value.lastName === "string" ? value.lastName.trim() : "";
  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) {
    return null;
  }

  const cin = typeof value.cin === "string" ? value.cin.trim() : "";
  return cin ? `${fullName} (CIN ${cin})` : fullName;
}

function summarizeSearchPatientResult(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.patients)) {
    return ["Patient search completed."];
  }

  const labels = result.patients
    .map((patient) => renderPatientLabel(patient))
    .filter((label): label is string => Boolean(label));

  if (labels.length === 0) {
    return ["No patient found matching the query."];
  }

  if (labels.length === 1) {
    return [`Found patient: ${labels[0]}.`];
  }

  return [`Found ${labels.length} patients: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", ..." : ""}.`];
}

function summarizeRagSearchResult(result: unknown, userPrompt: string): string[] {
  if (!isRecord(result) || !Array.isArray(result.matches)) {
    return ["Medical records search completed."];
  }

  if (isMedicationQuestion(userPrompt)) {
    const medications = extractMedicationLinesFromMatches(result.matches).slice(0, 8);
    if (medications.length === 0) {
      return ["I checked the medical records but could not extract explicit medication lines."];
    }

    return ["Medications found in patient records:", ...medications.map((entry) => `- ${entry}`)];
  }

  const matchCount = result.matches.length;
  if (matchCount === 0) {
    return ["No relevant records were found for this question."];
  }

  const topMatch = result.matches[0];
  const topContent =
    isRecord(topMatch) && typeof topMatch.content === "string"
      ? normalizeSummaryText(topMatch.content)
      : "";
  const topSource =
    isRecord(topMatch) && typeof topMatch.sourceLabel === "string" ? topMatch.sourceLabel : null;

  const summary = [
    `Found ${matchCount} relevant record match${matchCount > 1 ? "es" : ""}.`,
    topContent ? `Top match${topSource ? ` (${topSource})` : ""}: ${truncateText(topContent, 220)}` : null,
  ].filter((line): line is string => Boolean(line));

  return summary;
}

function summarizeGenericToolResult(toolName: string, result: unknown): string[] {
  if (!isRecord(result)) {
    return [`${humanizeToolName(toolName)} executed.`];
  }

  const lines: string[] = [];

  if (typeof result.message === "string") {
    lines.push(normalizeSummaryText(result.message));
  }

  if (typeof result.total === "number") {
    lines.push(`Total: ${result.total}.`);
  }

  const primaryArrayEntry = Object.entries(result).find(([, value]) => Array.isArray(value));
  if (primaryArrayEntry) {
    const [key, value] = primaryArrayEntry;
    const length = Array.isArray(value) ? value.length : 0;
    lines.push(`${humanizeToolName(key)}: ${length}.`);
  }

  const primitiveDetails = Object.entries(result)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .filter(([key]) => key !== "message" && key !== "total")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);

  if (primitiveDetails.length > 0) {
    lines.push(primitiveDetails.join(" | "));
  }

  if (lines.length === 0) {
    return [`${humanizeToolName(toolName)} completed successfully.`];
  }

  return lines;
}

function extractPatientNameFromSearchResult(items: ToolExecutionResultItem[]): string | null {
  const searchPatientResult = items.find((item) => item.tool === "search_patient")?.result;
  if (!isRecord(searchPatientResult) || !Array.isArray(searchPatientResult.patients)) {
    return null;
  }

  const first = searchPatientResult.patients[0];
  if (!isRecord(first)) {
    return null;
  }

  const firstName = typeof first.firstName === "string" ? first.firstName.trim() : "";
  const lastName = typeof first.lastName === "string" ? first.lastName.trim() : "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || null;
}

function formatConversationResultText(
  result: AgentExecutionResult,
  userPrompt: string,
): string | null {
  const items = parseToolExecutionItems(result.results);
  if (items.length === 0) {
    return result.finalMessage ?? result.message ?? null;
  }

  const lines: string[] = [];

  for (const item of items) {
    let sectionLines: string[];

    if (item.tool === "search_patient") {
      sectionLines = summarizeSearchPatientResult(item.result);
    } else if (item.tool === "search_medical_records_RAG") {
      sectionLines = summarizeRagSearchResult(item.result, userPrompt);
    } else {
      sectionLines = summarizeGenericToolResult(item.tool, item.result);
    }

    if (sectionLines.length > 0) {
      lines.push(...sectionLines);
    }
  }

  const uniqueLines = Array.from(
    new Set(
      lines
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );

  if (uniqueLines.length === 0) {
    return result.finalMessage ?? result.message ?? "Tools executed successfully.";
  }

  const patientName = extractPatientNameFromSearchResult(items);
  if (patientName && isMedicationQuestion(userPrompt)) {
    uniqueLines.unshift(`Answer for ${patientName}:`);
  }

  return truncateText(uniqueLines.join("\n"), 1600);
}

function sanitizeToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const calls: AgentToolCall[] = [];

  for (const item of value) {
    if (!isRecord(item) || typeof item.tool !== "string") {
      continue;
    }

    calls.push({
      tool: item.tool,
      args: isRecord(item.args) ? item.args : {},
      reason: typeof item.reason === "string" ? item.reason : undefined,
    });
  }

  return calls;
}

function getObjectIdCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!/^[a-fA-F0-9]{24}$/.test(value)) {
    return null;
  }

  return value;
}

function dedupeEntityRefs(entities: EntityReference[]): EntityReference[] {
  const seen = new Set<string>();
  const unique: EntityReference[] = [];

  for (const item of entities) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function collectEntityRefs(value: unknown, bucket: EntityReference[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectEntityRefs(item, bucket, depth + 1));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const id = getObjectIdCandidate(value._id) ?? getObjectIdCandidate(value.id);
  if (id) {
    if (typeof value.firstName === "string" && typeof value.lastName === "string") {
      bucket.push({
        type: "patient",
        id,
        label: `${value.firstName} ${value.lastName}`,
        hint: typeof value.cin === "string" ? `CIN ${value.cin}` : undefined,
      });
    } else if (typeof value.fullName === "string") {
      bucket.push({
        type: "doctor",
        id,
        label: value.fullName,
        hint: typeof value.specialty === "string" ? value.specialty : undefined,
      });
    } else if (typeof value.reason === "string" && typeof value.startAt === "string") {
      bucket.push({
        type: "appointment",
        id,
        label: value.reason,
        hint: `Start ${formatDateTime(value.startAt)}`,
      });
    }
  }

  Object.values(value).forEach((nested) => collectEntityRefs(nested, bucket, depth + 1));
}

function extractEntityRefs(payload: unknown): EntityReference[] {
  const bucket: EntityReference[] = [];
  collectEntityRefs(payload, bucket);
  return dedupeEntityRefs(bucket);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function entityKey(entry: EntityReference): string {
  return `${entry.type}:${entry.id}`;
}

function contextItemKindClass(kind: ContextItemKind): string {
  if (kind === "history") {
    return "bg-[#edf7ff] text-[#1a56a8]";
  }

  if (kind === "entity") {
    return "bg-[#ecfdf3] text-[#176742]";
  }

  return "bg-[#fff4e8] text-[#9a4f00]";
}

function contextItemKindLabel(kind: ContextItemKind): string {
  if (kind === "history") {
    return "History";
  }

  if (kind === "entity") {
    return "Entities";
  }

  return "Pending";
}

function contextPresetLabel(preset: ContextPreset): string {
  if (preset === "full") {
    return "Full";
  }

  if (preset === "history-only") {
    return "History only";
  }

  if (preset === "entities-only") {
    return "Entities only";
  }

  if (preset === "pending-only") {
    return "Pending only";
  }

  return "Custom";
}

function excludedKeysForPreset(
  preset: Exclude<ContextPreset, "custom">,
  items: ConversationContextItem[],
): string[] {
  if (preset === "full") {
    return [];
  }

  if (preset === "history-only") {
    return items.filter((item) => item.kind !== "history").map((item) => item.key);
  }

  if (preset === "entities-only") {
    return items.filter((item) => item.kind !== "entity").map((item) => item.key);
  }

  return items.filter((item) => item.kind !== "pending").map((item) => item.key);
}

function buildConversationContextPack(input: {
  role: UserRole;
  mode: PromptMode;
  history: HistoryItem[];
  entities: EntityReference[];
  pinnedKeys: Set<string>;
  excludedContextKeys: Set<string>;
  pendingAction: PendingActionState | null;
}): ConversationContextPack {
  const historyWindow = input.history.slice(0, MAX_CONTEXT_HISTORY_ITEMS).reverse();
  const historyItems: ConversationContextItem[] = historyWindow.map((item, index) => {
    const compactText = item.text.replace(/\s+/g, " ").trim();
    const line = `${index + 1}. [${item.kind}] ${item.title}: ${truncateText(compactText, 180)}`;

    return {
      key: `history:${item.id}`,
      kind: "history",
      label: `${item.kind} · ${truncateText(item.title, 36)}`,
      line,
    };
  });

  const sortedEntities = [...input.entities].sort((left, right) => {
    const leftPinned = input.pinnedKeys.has(entityKey(left));
    const rightPinned = input.pinnedKeys.has(entityKey(right));

    if (leftPinned === rightPinned) {
      return 0;
    }

    return leftPinned ? -1 : 1;
  });

  const entityItems: ConversationContextItem[] = sortedEntities
    .slice(0, MAX_CONTEXT_ENTITY_ITEMS)
    .map((item) => {
      const pinnedTag = input.pinnedKeys.has(entityKey(item)) ? " [pinned]" : "";
      const hint = item.hint ? ` (${item.hint})` : "";

      return {
        key: `entity:${entityKey(item)}`,
        kind: "entity",
        label: `${item.type} · ${truncateText(item.label, 36)}`,
        line: `- ${item.type}: ${item.label} | id=${item.id}${hint}${pinnedTag}`,
      };
    });

  const pendingItem: ConversationContextItem | undefined = input.pendingAction
    ? {
        key: `pending:${input.pendingAction.id}`,
        kind: "pending",
        label: "pending destructive action",
        line: `- Pending destructive action id=${input.pendingAction.id}${
          input.pendingAction.expiresAt ? `, expires=${input.pendingAction.expiresAt}` : ""
        }`,
      }
    : undefined;

  const items = [...historyItems, ...entityItems, ...(pendingItem ? [pendingItem] : [])];
  const includedItems = items.filter((item) => !input.excludedContextKeys.has(item.key));

  const historyLines = includedItems
    .filter((item) => item.kind === "history")
    .map((item) => item.line);
  const entityLines = includedItems
    .filter((item) => item.kind === "entity")
    .map((item) => item.line);
  const pendingLine = includedItems.find((item) => item.kind === "pending")?.line;

  const sections = [
    "Conversation memory for continuity.",
    `Requester role: ${input.role}`,
    `Current frontend mode: ${input.mode}`,
    "",
    "Recent interaction history:",
    historyLines.length > 0 ? historyLines.join("\n") : "- none",
    "",
    "Known IDs and entities:",
    entityLines.length > 0 ? entityLines.join("\n") : "- none",
    "",
    "Pending action status:",
    pendingLine ?? "- none",
    "",
    "Use this memory only when relevant to the new request.",
    "If ambiguous, prefer safe non-destructive clarification first.",
  ];

  const text = truncateText(sections.join("\n"), MAX_CONTEXT_CHARACTERS);

  return {
    text,
    historyLines,
    entityLines,
    pendingLine,
    items,
    includedCount: includedItems.length,
    totalCount: items.length,
  };
}

function buildPromptWithMode(mode: PromptMode, prompt: string, contextPack?: string): string {
  const modeInstruction =
    mode === "fetch"
      ? "Mode: Fetch and summarize data only unless user explicitly asks for mutation."
      : "Mode: Insert or update data when needed. If destructive, prepare pending confirmation safely.";

  if (contextPack) {
    return [
      modeInstruction,
      "Conversation context from previous turns:",
      contextPack,
      "Current user request:",
      prompt,
    ].join("\n\n");
  }

  if (mode === "fetch") {
    return [modeInstruction, prompt].join("\n\n");
  }

  return [modeInstruction, prompt].join("\n\n");
}

const BASE_QUICK_PROMPTS: QuickPrompt[] = [
  {
    title: "Today schedule",
    mode: "fetch",
    prompt: "Show me today schedule in Africa/Casablanca and summarize by doctor.",
  },
  {
    title: "Find by CIN",
    mode: "fetch",
    prompt: "Find patient by CIN AB123456 and show basic profile.",
  },
  {
    title: "Uncontacted patients",
    mode: "fetch",
    prompt: "List uncontacted patients for the last 90 days with total count.",
  },
  {
    title: "List doctors",
    mode: "fetch",
    prompt: "List all active doctors in the facility with their specialties and IDs.",
  },
  {
    title: "List patients",
    mode: "fetch",
    prompt: "List all accessible patients with IDs, CIN, and key profile fields.",
  },
  {
    title: "Create patient",
    mode: "insert",
    prompt:
      "Create a patient with first name Youssef, last name Amrani, CIN AB123456, phone +212600000000, email youssef.amrani@example.com, and pathologies hypertension and asthma.",
  },
  {
    title: "Create appointment",
    mode: "insert",
    prompt:
      "Create an appointment for patient <PATIENT_ID> with doctor <DOCTOR_ID> on 2026-04-20 at 10:00 for post-op follow up, 60 minutes.",
  },
  {
    title: "Add patient note",
    mode: "insert",
    prompt: "Add a patient note for <PATIENT_ID>: blood pressure stabilized after medication adjustment.",
  },
  {
    title: "RAG search",
    mode: "fetch",
    prompt:
      "Run RAG search for patient <PATIENT_ID> with query: prior imaging findings related to chest pain.",
  },
  {
    title: "Create doctor account + profile",
    mode: "insert",
    prompt:
      "Create a doctor staff account with name Dr. Lina Haddad, email lina.haddad@clinic.local, password ChangeMe123!, role doctor; then create a doctor profile for Dr. Lina Haddad with specialty Cardiology linked by userEmail lina.haddad@clinic.local.",
  },
];

export default function Home() {
  const [token, setToken] = useState<Nullable<string>>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  });
  const [currentUser, setCurrentUser] = useState<Nullable<AuthUser>>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Nullable<Feedback>>(null);

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

  const [promptMode, setPromptMode] = useState<PromptMode>("fetch");
  const [promptText, setPromptText] = useState("");
  const [maxToolCalls, setMaxToolCalls] = useState(3);
  const [uploadForm, setUploadForm] = useState<{
    patientId: string;
    mode: AIRecordMode;
    title: string;
    prompt: string;
  }>({
    patientId: "",
    mode: "rag",
    title: "",
    prompt: "",
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [contextEnabled, setContextEnabled] = useState(true);
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [excludedContextItemKeys, setExcludedContextItemKeys] = useState<string[]>([]);
  const [contextPreset, setContextPreset] = useState<ContextPreset>("full");
  const [collapsedContextGroups, setCollapsedContextGroups] = useState<
    Record<ContextItemKind, boolean>
  >({
    history: false,
    entity: false,
    pending: false,
  });
  const [pinnedEntityKeys, setPinnedEntityKeys] = useState<string[]>([]);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pendingAction, setPendingAction] = useState<Nullable<PendingActionState>>(null);
  const [lastResult, setLastResult] = useState<Nullable<unknown>>(null);
  const [entityMemory, setEntityMemory] = useState<EntityReference[]>([]);

  const showFeedback = useCallback((type: FeedbackType, message: string) => {
    setFeedback({ type, message });
  }, []);

  const pushHistory = useCallback((item: Omit<HistoryItem, "id" | "createdAt">) => {
    setHistory((previous) => {
      const nextEntry: HistoryItem = {
        ...item,
        id: createId("history"),
        createdAt: Date.now(),
      };

      return [nextEntry, ...previous].slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setHistory([]);
    setPendingAction(null);
    setLastResult(null);
    setEntityMemory([]);
    setPinnedEntityKeys([]);
    setExcludedContextItemKeys([]);
    setContextPreset("full");
    setCollapsedContextGroups({
      history: false,
      entity: false,
      pending: false,
    });
    setContextEnabled(true);
    setShowContextPreview(false);

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

      const requestUrl = buildApiUrl(path);
      const requestMethod = options?.method ?? "GET";

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          ...options,
          headers,
          credentials: "include",
          cache: "no-store",
        });
      } catch (error) {
        throw new Error(`Network error for ${requestMethod} ${requestUrl}: ${extractErrorMessage(error)}`);
      }

      const payload = (await response.json().catch(() => null)) as (ApiEnvelope<T> & {
        issues?: unknown;
        details?: unknown;
      }) | null;

      if (!response.ok) {
        if (response.status === 401 && token) {
          clearSession();
        }

        const baseMessage =
          formatApiErrorMessage(payload) ??
          payload?.message ??
          `Request failed with status ${response.status}`;

        throw new Error(
          `${baseMessage} | HTTP ${response.status} ${requestMethod} ${requestUrl}`,
        );
      }

      return payload?.data as T;
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
      showFeedback("error", extractErrorMessage(error));
    }
  }, [apiRequest, clearSession, showFeedback, token]);

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

  const applyOutcomeToMemory = useCallback((payload: unknown) => {
    const extracted = extractEntityRefs(payload);
    if (extracted.length === 0) {
      return;
    }

    setEntityMemory((current) => {
      const merged = dedupeEntityRefs([...extracted, ...current]).slice(0, MAX_ENTITY_MEMORY);

      setPinnedEntityKeys((existingKeys) => {
        const available = new Set(merged.map((item) => entityKey(item)));
        return existingKeys.filter((key) => available.has(key));
      });

      return merged;
    });
  }, []);

  const clearConversationMemory = useCallback(() => {
    setHistory([]);
    setPendingAction(null);
    setLastResult(null);
    setEntityMemory([]);
    setPinnedEntityKeys([]);
    setExcludedContextItemKeys([]);
    setContextPreset("full");
    showFeedback("info", "Conversation memory cleared.");
  }, [showFeedback]);

  const handleTogglePinnedEntity = useCallback((entry: EntityReference) => {
    const key = entityKey(entry);

    setPinnedEntityKeys((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [key, ...current].slice(0, MAX_ENTITY_MEMORY);
    });
  }, []);

  const pinnedEntityKeySet = useMemo(() => new Set(pinnedEntityKeys), [pinnedEntityKeys]);
  const excludedContextKeySet = useMemo(
    () => new Set(excludedContextItemKeys),
    [excludedContextItemKeys],
  );

  const contextPack = useMemo<ConversationContextPack>(() => {
    if (!currentUser) {
      return {
        text: "",
        historyLines: [],
        entityLines: [],
        items: [],
        includedCount: 0,
        totalCount: 0,
      };
    }

    return buildConversationContextPack({
      role: currentUser.role,
      mode: promptMode,
      history,
      entities: entityMemory,
      pinnedKeys: pinnedEntityKeySet,
      excludedContextKeys: excludedContextKeySet,
      pendingAction,
    });
  }, [
    currentUser,
    promptMode,
    history,
    entityMemory,
    pinnedEntityKeySet,
    excludedContextKeySet,
    pendingAction,
  ]);

  const handleToggleContextItem = useCallback((key: string) => {
    setContextPreset("custom");
    setExcludedContextItemKeys((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [key, ...current];
    });
  }, []);

  const handleIncludeAllContextItems = useCallback(() => {
    setExcludedContextItemKeys([]);
    setContextPreset("full");
  }, []);

  const handleExcludeAllContextItems = useCallback(() => {
    setContextPreset("custom");
    setExcludedContextItemKeys(contextPack.items.map((item) => item.key));
  }, [contextPack.items]);

  const handleApplyContextPreset = useCallback(
    (preset: Exclude<ContextPreset, "custom">) => {
      setContextPreset(preset);
      setExcludedContextItemKeys(excludedKeysForPreset(preset, contextPack.items));
    },
    [contextPack.items],
  );

  const groupedContextItems = useMemo<Record<ContextItemKind, ConversationContextItem[]>>(() => {
    const grouped: Record<ContextItemKind, ConversationContextItem[]> = {
      history: [],
      entity: [],
      pending: [],
    };

    for (const item of contextPack.items) {
      grouped[item.kind].push(item);
    }

    return grouped;
  }, [contextPack.items]);

  const handleToggleContextGroup = useCallback((kind: ContextItemKind) => {
    setCollapsedContextGroups((current) => ({
      ...current,
      [kind]: !current[kind],
    }));
  }, []);

  const handleIncludeContextGroup = useCallback(
    (kind: ContextItemKind) => {
      const keys = groupedContextItems[kind].map((item) => item.key);
      if (keys.length === 0) {
        return;
      }

      setContextPreset("custom");
      setExcludedContextItemKeys((current) => current.filter((key) => !keys.includes(key)));
    },
    [groupedContextItems],
  );

  const handleExcludeContextGroup = useCallback(
    (kind: ContextItemKind) => {
      const keys = groupedContextItems[kind].map((item) => item.key);
      if (keys.length === 0) {
        return;
      }

      setContextPreset("custom");
      setExcludedContextItemKeys((current) => Array.from(new Set([...current, ...keys])));
    },
    [groupedContextItems],
  );

  const handleBootstrapAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);

    try {
      await apiRequest<AuthUser>("/auth/bootstrap-admin", {
        method: "POST",
        body: JSON.stringify(bootstrapForm),
      });

      showFeedback("success", "Admin bootstrapped. You can now login.");
      setBootstrapForm({ bootstrapKey: "", name: "", email: "", password: "" });
    } catch (error) {
      showFeedback("error", extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);

    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });

      setToken(result.accessToken);
      setCurrentUser(result.user);
      showFeedback("success", "Login successful.");
      setLoginForm({ email: "", password: "" });
    } catch (error) {
      showFeedback("error", extractErrorMessage(error));
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
      // Ignore network or backend logout failures and still clear client state.
    } finally {
      clearSession();
      setBusy(false);
      showFeedback("info", "Logged out.");
    }
  };

  const executeAgentPrompt = async () => {
    const trimmed = promptText.trim();
    if (!trimmed) {
      showFeedback("error", "Please enter a prompt.");
      return;
    }

    const finalPrompt = buildPromptWithMode(
      promptMode,
      trimmed,
      contextEnabled && contextPack.includedCount > 0 ? contextPack.text : undefined,
    );
    setBusy(true);

    pushHistory({
      kind: "prompt",
      title: promptMode === "fetch" ? "Fetch command" : "Insert command",
      text: `${trimmed}\n\nContext enabled: ${contextEnabled ? "yes" : "no"}${
        contextEnabled
          ? `\nIncluded context items: ${contextPack.includedCount}/${contextPack.totalCount}\nPreset: ${contextPreset}`
          : ""
      }`,
    });

    try {
      const result = await apiRequest<AgentExecutionResult>("/agent/execute", {
        method: "POST",
        body: JSON.stringify({
          prompt: finalPrompt,
          maxToolCalls,
        }),
        idempotencyKey: createId("agent-execute"),
      });

      const plannedCalls = sanitizeToolCalls(result.plannedToolCalls);
      if (result.requiresConfirmation && result.pendingActionId) {
        setPendingAction({
          id: result.pendingActionId,
          expiresAt: result.expiresAt,
          plannedToolCalls: plannedCalls,
        });
      } else {
        setPendingAction(null);
      }

      setLastResult(result);
      applyOutcomeToMemory(result);

      const formattedConversationText = formatConversationResultText(result, trimmed);

      pushHistory({
        kind: "result",
        title: result.requiresConfirmation ? "Confirmation required" : "Execution result",
        text:
          formattedConversationText ??
          result.finalMessage ??
          result.message ??
          (result.requiresConfirmation
            ? "Destructive action is pending your approval."
            : "Agent completed execution."),
        payload: result,
      });

      showFeedback("success", result.message ?? "Agent command processed.");
      setPromptText("");
    } catch (error) {
      const message = extractErrorMessage(error);
      pushHistory({
        kind: "system",
        title: "Command error",
        text: message,
      });
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await executeAgentPrompt();
  };

  const handleConfirmPendingAction = async (approved: boolean) => {
    if (!pendingAction) {
      showFeedback("error", "No pending action to confirm.");
      return;
    }

    setBusy(true);

    try {
      const result = await apiRequest<AgentConfirmResult>(`/agent/actions/${pendingAction.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ approved }),
        idempotencyKey: createId("agent-confirm"),
      });

      setLastResult(result);
      applyOutcomeToMemory(result);

      pushHistory({
        kind: "result",
        title: approved ? "Pending action approved" : "Pending action rejected",
        text: result.message,
        payload: result,
      });

      setPendingAction(null);
      showFeedback(approved ? "success" : "info", result.message);
    } catch (error) {
      showFeedback("error", extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyId = async (id: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      showFeedback("error", "Clipboard API is unavailable in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(id);
      showFeedback("info", `Copied ID ${id}`);
    } catch {
      showFeedback("error", "Unable to copy ID to clipboard.");
    }
  };

  const handleUploadFiles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!uploadForm.patientId.trim()) {
      showFeedback("error", "Patient ID is required for file upload.");
      return;
    }

    if (selectedFiles.length === 0) {
      showFeedback("error", "Select at least one file before uploading.");
      return;
    }

    setBusy(true);

    const fileNames = selectedFiles.map((file) => file.name).join(", ");
    pushHistory({
      kind: "prompt",
      title: "File upload command",
      text: `Mode: ${uploadForm.mode} | Patient: ${uploadForm.patientId} | Files: ${fileNames}`,
    });

    try {
      const formData = new FormData();
      formData.append("patientId", uploadForm.patientId.trim());
      formData.append("mode", uploadForm.mode);

      if (uploadForm.title.trim()) {
        formData.append("title", uploadForm.title.trim());
      }

      if (uploadForm.prompt.trim()) {
        formData.append("prompt", uploadForm.prompt.trim());
      }

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await apiRequest<unknown>("/ai/records/upload", {
        method: "POST",
        body: formData,
      });

      setLastResult(result);
      applyOutcomeToMemory(result);

      pushHistory({
        kind: "result",
        title: "File upload processed",
        text: `Uploaded ${selectedFiles.length} file(s) and created an AI record (${uploadForm.mode}).`,
        payload: result,
      });

      showFeedback("success", "Files uploaded and processed successfully.");
      setUploadForm((current) => ({
        ...current,
        title: "",
        prompt: "",
      }));
      setSelectedFiles([]);
      setFileInputKey((current) => current + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      pushHistory({
        kind: "system",
        title: "File upload error",
        text: message,
      });
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  };

  const quickPrompts = useMemo(() => {
    const prioritizedEntities = [...entityMemory].sort((left, right) => {
      const leftPinned = pinnedEntityKeySet.has(entityKey(left));
      const rightPinned = pinnedEntityKeySet.has(entityKey(right));

      if (leftPinned === rightPinned) {
        return 0;
      }

      return leftPinned ? -1 : 1;
    });

    const firstPatient = prioritizedEntities.find((entry) => entry.type === "patient");
    const firstDoctor = prioritizedEntities.find((entry) => entry.type === "doctor");

    return BASE_QUICK_PROMPTS.map((item) => {
      let prompt = item.prompt;

      if (firstPatient) {
        prompt = prompt.replaceAll("<PATIENT_ID>", firstPatient.id);
      }

      if (firstDoctor) {
        prompt = prompt.replaceAll("<DOCTOR_ID>", firstDoctor.id);
      }

      return {
        ...item,
        prompt,
      };
    });
  }, [entityMemory, pinnedEntityKeySet]);

  const fetchCount = quickPrompts.filter((item) => item.mode === "fetch").length;
  const insertCount = quickPrompts.filter((item) => item.mode === "insert").length;
  const knownPatients = useMemo(
    () => entityMemory.filter((entry) => entry.type === "patient"),
    [entityMemory],
  );
  const chatMessages = useMemo(() => [...history].reverse(), [history]);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = chatHistoryRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [chatMessages.length]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
      <header className="shell-card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-[#0b6e6e1a] blur-2xl" />
        <div className="absolute -bottom-20 -left-16 h-40 w-40 rounded-full bg-[#1a56a81f] blur-2xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="code-text text-xs uppercase tracking-[0.18em] text-[#1a56a8]">MediAssist IA</p>
            <h1 className="mt-2 text-3xl font-semibold text-[#0b3642] sm:text-4xl">
              AI-First Clinical Command Center
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
              Use natural language prompts to insert and fetch operational data. The UI emphasizes
              AI-driven orchestration and only keeps minimal manual controls for authentication.
            </p>
          </div>

          <div className="space-y-2 text-right">
            <p className="code-text text-xs text-slate-500">API Base</p>
            <p className="code-text rounded-lg border border-[#d6e6e6] bg-white px-3 py-2 text-xs text-[#16444f]">
              {API_BASE_URL}
            </p>
          </div>
        </div>
      </header>

      {feedback && (
        <div
          className={`shell-card px-4 py-3 text-sm ${
            feedback.type === "error"
              ? "border-[#f1c7c7] text-[#9b1c1c]"
              : feedback.type === "success"
                ? "border-[#c6eadb] text-[#176742]"
                : "border-[#c6daf4] text-[#1a56a8]"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {!token || !currentUser ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="shell-card p-6">
            <h2 className="text-xl font-semibold text-[#0f3a44]">Initial Admin Setup</h2>
            <p className="mt-2 text-sm text-slate-600">
              Run once to create your first admin user with the backend bootstrap key.
            </p>
            <form className="mt-5 grid gap-3" onSubmit={handleBootstrapAdmin}>
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Bootstrap key"
                value={bootstrapForm.bootstrapKey}
                onChange={(event) =>
                  setBootstrapForm((prev) => ({ ...prev, bootstrapKey: event.target.value }))
                }
                minLength={8}
                required
              />
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Full name"
                value={bootstrapForm.name}
                onChange={(event) => setBootstrapForm((prev) => ({ ...prev, name: event.target.value }))}
                minLength={2}
                required
              />
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                value={bootstrapForm.email}
                onChange={(event) => setBootstrapForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                value={bootstrapForm.password}
                onChange={(event) =>
                  setBootstrapForm((prev) => ({ ...prev, password: event.target.value }))
                }
                minLength={8}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-2 rounded-xl bg-[#0b6e6e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a5f5f] disabled:opacity-60"
              >
                Create Admin
              </button>
            </form>
          </div>

          <div className="shell-card p-6">
            <h2 className="text-xl font-semibold text-[#0f3a44]">Sign In</h2>
            <p className="mt-2 text-sm text-slate-600">
              Sign in to run AI commands for patient operations.
            </p>
            <form className="mt-5 grid gap-3" onSubmit={handleLogin}>
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
              <input
                className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                minLength={8}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-2 rounded-xl bg-[#1a56a8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#164b93] disabled:opacity-60"
              >
                Login
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="grid min-w-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="shell-card p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Session</p>
              <h3 className="mt-2 text-lg font-semibold text-[#0f3a44]">{currentUser.name}</h3>
              <p className="text-sm text-slate-600">{currentUser.email}</p>
              <div className="mt-2">
                <span className={rolePillClass(currentUser.role)}>{currentUser.role}</span>
              </div>

              <button
                onClick={handleLogout}
                disabled={busy}
                className="mt-5 w-full rounded-xl border border-[#ecc7c7] bg-[#fff2f2] px-3 py-2 text-sm font-semibold text-[#9b1c1c] transition hover:bg-[#ffe7e7] disabled:opacity-60"
              >
                Logout
              </button>
            </section>

            <section className="shell-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[#0f3a44]">Prompt Shortcuts</h3>
                <span className="pill bg-[#eef7ff] text-[#1a56a8]">
                  {fetchCount} fetch / {insertCount} insert
                </span>
              </div>

              <div className="mt-4 grid gap-2">
                {quickPrompts.map((item) => (
                  <button
                    key={`${item.title}:${item.mode}`}
                    onClick={() => {
                      setPromptMode(item.mode);
                      setPromptText(item.prompt);
                    }}
                    className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-left text-sm text-[#15414d] transition hover:bg-[#f2fafa]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{item.title}</span>
                      <span className={`pill ${item.mode === "fetch" ? "bg-[#edf7ff] text-[#1a56a8]" : "bg-[#ecfdf3] text-[#176742]"}`}>
                        {item.mode}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="shell-card p-5">
              <h3 className="text-base font-semibold text-[#0f3a44]">ID Memory</h3>
              <p className="mt-2 text-sm text-slate-600">
                AI results auto-fill this memory so you can reuse IDs in follow-up prompts.
              </p>

              <div className="mt-3 space-y-2">
                {entityMemory.length === 0 ? (
                  <p className="text-sm text-slate-500">No entities captured yet.</p>
                ) : (
                  entityMemory.map((entry) => (
                    <article key={`${entry.type}:${entry.id}`} className="rounded-xl border border-[#d8e8e8] bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="pill bg-[#f5fbfb] text-[#15414d]">{entry.type}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleTogglePinnedEntity(entry)}
                              className={`code-text rounded-lg border px-2 py-1 text-[11px] ${
                                pinnedEntityKeySet.has(entityKey(entry))
                                  ? "border-[#e9d8ad] bg-[#fff9ec] text-[#7a4f07]"
                                  : "border-[#cfe2e2] text-[#1a56a8]"
                              }`}
                            >
                              {pinnedEntityKeySet.has(entityKey(entry)) ? "unpin" : "pin"}
                            </button>
                            <button
                              onClick={() => void handleCopyId(entry.id)}
                              className="code-text rounded-lg border border-[#cfe2e2] px-2 py-1 text-[11px] text-[#1a56a8]"
                            >
                              copy id
                            </button>
                          </div>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#11333f]">{entry.label}</p>
                      {entry.hint && <p className="mt-1 text-xs text-slate-600">{entry.hint}</p>}
                        {pinnedEntityKeySet.has(entityKey(entry)) && (
                          <p className="mt-1 text-xs font-semibold text-[#7a4f07]">Pinned for context</p>
                        )}
                      <p className="code-text mt-2 text-[11px] text-[#1a56a8]">{entry.id}</p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="shell-card p-5">
              <h3 className="text-base font-semibold text-[#0f3a44]">Governance</h3>
              <p className="mt-2 text-sm text-slate-600">
                Destructive actions remain pending for confirmation, and only the original requester
                can approve within 10 minutes.
              </p>
            </section>
          </aside>

          <main className="min-w-0 space-y-6 overflow-x-hidden [&>section]:min-w-0">
            <section className="shell-card p-5 sm:p-6">
              <h2 className="text-2xl font-semibold text-[#0f3a44]">AI Chat Workspace</h2>
              <p className="mt-2 text-sm text-slate-600">
                Chat continuously with the AI. Prompt and response history stays visible while you
                type so you can follow context without leaving this panel.
              </p>

              <form className="mt-5 grid gap-3" onSubmit={handleExecuteAgent}>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPromptMode("fetch")}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                      promptMode === "fetch"
                        ? "bg-[#1a56a8] text-white"
                        : "bg-[#edf7ff] text-[#1a56a8]"
                    }`}
                  >
                    Fetch mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptMode("insert")}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                      promptMode === "insert"
                        ? "bg-[#176742] text-white"
                        : "bg-[#ecfdf3] text-[#176742]"
                    }`}
                  >
                    Insert mode
                  </button>
                </div>

                <div className="min-w-0 overflow-x-hidden rounded-xl border border-[#d6e6e6] bg-[#f8fcfc] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setContextEnabled((value) => !value)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                        contextEnabled
                          ? "bg-[#0b6e6e] text-white"
                          : "bg-[#eef7ff] text-[#1a56a8]"
                      }`}
                    >
                      Conversation memory: {contextEnabled ? "ON" : "OFF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowContextPreview((value) => !value)}
                      className="rounded-lg border border-[#cfe2e2] bg-white px-3 py-2 text-xs font-semibold text-[#15414d]"
                    >
                      {showContextPreview ? "Hide context preview" : "Show context preview"}
                    </button>
                    <button
                      type="button"
                      onClick={clearConversationMemory}
                      className="rounded-lg border border-[#ecc7c7] bg-[#fff2f2] px-3 py-2 text-xs font-semibold text-[#9b1c1c]"
                    >
                      Clear conversation
                    </button>
                  </div>

                  <p className="mt-2 text-xs text-slate-600">
                    Context pack active items: {contextPack.includedCount}/{contextPack.totalCount}
                    {" "}(history: {contextPack.historyLines.length}, entities: {contextPack.entityLines.length}
                    {contextPack.pendingLine ? ", pending action: 1" : ", pending action: 0"}).
                  </p>

                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Presets</span>
                    {([
                      "full",
                      "history-only",
                      "entities-only",
                      "pending-only",
                    ] as Exclude<ContextPreset, "custom">[]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleApplyContextPreset(preset)}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                          contextPreset === preset
                            ? "border-transparent bg-[#0b6e6e] text-white"
                            : "border-[#cfe2e2] bg-white text-[#15414d]"
                        }`}
                      >
                        {contextPresetLabel(preset)}
                      </button>
                    ))}

                    <span className="pill max-w-full break-words bg-[#f8fafb] text-slate-600">
                      Current: {contextPresetLabel(contextPreset)}
                    </span>
                  </div>

                  {contextPack.items.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-slate-600">
                        Context chips: click to include or exclude individual memory items before
                        sending your prompt.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleIncludeAllContextItems}
                          className="rounded-lg border border-[#cfe2e2] bg-white px-3 py-2 text-xs font-semibold text-[#15414d]"
                        >
                          Include all
                        </button>
                        <button
                          type="button"
                          onClick={handleExcludeAllContextItems}
                          disabled={contextPack.items.length === 0}
                          className="rounded-lg border border-[#e7d8b4] bg-[#fff9ec] px-3 py-2 text-xs font-semibold text-[#7a4f07] disabled:opacity-50"
                        >
                          Exclude all
                        </button>
                      </div>

                      <div className="min-w-0 space-y-2">
                        {(["history", "entity", "pending"] as ContextItemKind[]).map((kind) => {
                          const items = groupedContextItems[kind];
                          if (items.length === 0) {
                            return null;
                          }

                          const includedCount = items.filter(
                            (item) => !excludedContextKeySet.has(item.key),
                          ).length;

                          return (
                            <article
                              key={kind}
                              className="min-w-0 rounded-xl border border-[#d6e6e6] bg-white p-3"
                            >
                              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className={`pill ${contextItemKindClass(kind)}`}>
                                    {contextItemKindLabel(kind)}
                                  </span>
                                  <span className="text-[11px] text-slate-600">
                                    {includedCount}/{items.length} included
                                  </span>
                                </div>

                                <div className="flex flex-wrap gap-2 sm:justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleIncludeContextGroup(kind)}
                                    className="rounded-lg border border-[#cfe2e2] bg-white px-2 py-1 text-[11px] font-semibold text-[#15414d]"
                                  >
                                    Include group
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleExcludeContextGroup(kind)}
                                    className="rounded-lg border border-[#e7d8b4] bg-[#fff9ec] px-2 py-1 text-[11px] font-semibold text-[#7a4f07]"
                                  >
                                    Exclude group
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleContextGroup(kind)}
                                    className="rounded-lg border border-[#d3dce2] bg-[#f8fafb] px-2 py-1 text-[11px] font-semibold text-slate-700"
                                  >
                                    {collapsedContextGroups[kind] ? "Expand" : "Collapse"}
                                  </button>
                                </div>
                              </div>

                              {!collapsedContextGroups[kind] && (
                                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                                  {items.map((item) => {
                                    const isExcluded = excludedContextKeySet.has(item.key);

                                    return (
                                      <button
                                        key={item.key}
                                        type="button"
                                        aria-pressed={!isExcluded}
                                        onClick={() => handleToggleContextItem(item.key)}
                                        className={`max-w-full break-words rounded-full border px-3 py-1 text-left text-[11px] font-semibold transition ${
                                          isExcluded
                                            ? "border-[#d3dce2] bg-white text-slate-500 line-through"
                                            : `border-transparent ${contextItemKindClass(item.kind)}`
                                        }`}
                                        title={item.line}
                                      >
                                        {item.label} {isExcluded ? "(off)" : "(on)"}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      No context items available yet. Run at least one prompt first.
                    </p>
                  )}

                  {showContextPreview && (
                    <pre className="code-text mt-3 max-h-44 max-w-full overflow-auto rounded-xl bg-white p-3 text-[11px] text-[#173b46]">
                      {contextPack.text || "No context available yet."}
                    </pre>
                  )}
                </div>

                <div className="rounded-xl border border-[#d6e6e6] bg-white p-3">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-[#11333f]">Conversation</h3>
                    <span className="pill bg-[#f5fbfb] text-[#15414d]">
                      {chatMessages.length} messages
                    </span>
                  </div>

                  {chatMessages.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">
                      Start with your first prompt. Messages will appear here in chat format.
                    </p>
                  ) : (
                    <div ref={chatHistoryRef} className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                      {chatMessages.map((item) => {
                        const isPrompt = item.kind === "prompt";
                        const bubbleClass = isPrompt
                          ? "ml-auto border-[#bcd7f2] bg-[#edf7ff]"
                          : item.kind === "system"
                            ? "mr-auto border-[#f0d9c7] bg-[#fff4e8]"
                            : "mr-auto border-[#cce8d9] bg-[#ecfdf3]";

                        return (
                          <article
                            key={item.id}
                            className={`max-w-[94%] min-w-0 rounded-xl border p-3 ${bubbleClass}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={historyBadgeClass(item.kind)}>{item.kind}</span>
                              <span className="code-text text-[11px] text-slate-500">
                                {formatDateTime(new Date(item.createdAt).toISOString())}
                              </span>
                            </div>

                            <h4 className="mt-2 text-sm font-semibold text-[#11333f]">{item.title}</h4>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                              {item.text}
                            </p>

                            {item.payload !== undefined && (
                              <details className="mt-2 min-w-0">
                                <summary className="cursor-pointer text-xs text-[#1a56a8]">
                                  View raw payload
                                </summary>
                                <pre className="code-text mt-2 max-h-56 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 text-[11px] text-[#173b46]">
                                  {safeJson(item.payload)}
                                </pre>
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>

                <textarea
                  className="min-h-28 rounded-xl border border-[#cfe2e2] bg-white px-3 py-3 text-sm"
                  placeholder="Continue the conversation. Example: list all active doctors and then create an appointment for the first one."
                  value={promptText}
                  onChange={(event) => setPromptText(event.target.value)}
                  required
                />

                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm text-slate-700">
                    Max tool calls
                    <input
                      className="ml-3 w-24 rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={8}
                      value={maxToolCalls}
                      onChange={(event) => setMaxToolCalls(Number(event.target.value) || 1)}
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-xl bg-[#0b6e6e] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#0a5f5f] disabled:opacity-60"
                  >
                    {busy ? "Processing..." : "Run AI Command"}
                  </button>
                </div>
              </form>
            </section>

            <section className="shell-card p-5 sm:p-6">
              <h3 className="text-xl font-semibold text-[#0f3a44]">Document Upload (RAG and non-RAG)</h3>
              <p className="mt-2 text-sm text-slate-600">
                Upload pdf, doc/docx, xls/xlsx, csv, or txt files to create AI records from
                document content. Choose rag mode to index uploaded chunks for retrieval.
              </p>

              <form className="mt-4 grid gap-3" onSubmit={handleUploadFiles}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                    placeholder="Patient ID (Mongo ObjectId)"
                    value={uploadForm.patientId}
                    onChange={(event) =>
                      setUploadForm((current) => ({
                        ...current,
                        patientId: event.target.value,
                      }))
                    }
                    list="known-patient-ids"
                    required
                  />

                  <select
                    className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                    value={uploadForm.mode}
                    onChange={(event) =>
                      setUploadForm((current) => ({
                        ...current,
                        mode: event.target.value as AIRecordMode,
                      }))
                    }
                  >
                    <option value="rag">rag</option>
                    <option value="non_rag">non_rag</option>
                  </select>
                </div>

                <datalist id="known-patient-ids">
                  {knownPatients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.label}
                    </option>
                  ))}
                </datalist>

                {knownPatients.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstPatient = knownPatients[0];
                      if (!firstPatient) {
                        return;
                      }

                      setUploadForm((current) => ({
                        ...current,
                        patientId: firstPatient.id,
                      }));
                    }}
                    className="w-fit rounded-lg border border-[#cfe2e2] bg-[#f6fbfb] px-3 py-2 text-xs font-semibold text-[#15414d]"
                  >
                    Use first remembered patient ID
                  </button>
                )}

                <input
                  className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                  placeholder="Record title (optional)"
                  value={uploadForm.title}
                  maxLength={120}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />

                <textarea
                  className="min-h-24 rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                  placeholder="Optional analysis prompt. Leave empty to use the default summarization prompt."
                  value={uploadForm.prompt}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                />

                <input
                  key={fileInputKey}
                  className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    setSelectedFiles(files);
                  }}
                />

                {selectedFiles.length > 0 && (
                  <p className="text-xs text-slate-600">
                    Selected: {selectedFiles.map((file) => file.name).join(", ")}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-[#1a56a8] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#164b93] disabled:opacity-60"
                >
                  {busy ? "Uploading..." : "Upload Files and Generate Record"}
                </button>
              </form>
            </section>

            {pendingAction && (
              <section className="shell-card border-[#e3d8bc] bg-[#fff9ec] p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-[#7a4f07]">Pending Destructive Action</h3>
                <p className="mt-2 text-sm text-[#7a4f07]">
                  Approval is required before execution. This pending action can only be confirmed by
                  your current account.
                </p>
                <p className="code-text mt-2 text-xs text-[#7a4f07]">Action ID: {pendingAction.id}</p>
                {pendingAction.expiresAt && (
                  <p className="text-xs text-[#7a4f07]">Expires at: {formatDateTime(pendingAction.expiresAt)}</p>
                )}

                {pendingAction.plannedToolCalls.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-semibold text-[#7a4f07]">Planned tool calls</p>
                    {pendingAction.plannedToolCalls.map((call, index) => (
                      <article key={`${call.tool}:${index}`} className="rounded-xl border border-[#eadcb9] bg-white/80 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="code-text text-xs text-[#7a4f07]">{call.tool}</span>
                          {call.reason && <span className="text-xs text-slate-600">{call.reason}</span>}
                        </div>
                        <details className="mt-2 min-w-0">
                          <summary className="cursor-pointer text-xs text-[#7a4f07]">View args</summary>
                          <pre className="code-text mt-2 max-h-56 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[#fdf6e8] p-2 text-[11px] text-[#724a06]">
                            {safeJson(call.args)}
                          </pre>
                        </details>
                      </article>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => void handleConfirmPendingAction(true)}
                    disabled={busy}
                    className="rounded-xl bg-[#176742] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Approve and Execute
                  </button>
                  <button
                    onClick={() => void handleConfirmPendingAction(false)}
                    disabled={busy}
                    className="rounded-xl bg-[#9b1c1c] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </section>
            )}

            <section className="shell-card p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-[#0f3a44]">Latest Agent Response</h3>
              <p className="mt-2 text-sm text-slate-600">
                Use this panel for quick debugging of tool plans and execution output.
              </p>

              <pre className="code-text mt-3 max-h-[420px] w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[#f5fbfb] p-3 text-xs text-[#173b46]">
                {safeJson(lastResult)}
              </pre>
            </section>
          </main>
        </section>
      )}
    </div>
  );
}
