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
  error?: string;
}

interface AgentConfirmResult {
  pendingActionId: string;
  status: "rejected" | "executed";
  message: string;
  results?: unknown;
}

interface AgentHistoryEntry {
  id: string;
  prompt: string;
  plannerResponse: string;
  toolResults: ToolExecutionResultItem[];
  requiresConfirmation: boolean;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}

interface RAGSourceFileItem {
  fileName: string;
  extension: string;
  chunkCount: number | null;
}

interface RAGRecordListItem {
  id: string;
  title: string | null;
  prompt: string;
  provider: string | null;
  createdAt: string | null;
  sourceFiles: RAGSourceFileItem[];
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
      error: typeof candidate.error === "string" ? candidate.error : undefined,
    });
  }

  return items;
}

function extractUserRequestFromStoredPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }

  const explicitRequestMarker = "current user request:";
  const markerIndex = trimmed.toLowerCase().lastIndexOf(explicitRequestMarker);
  if (markerIndex !== -1) {
    const candidate = trimmed.slice(markerIndex + explicitRequestMarker.length).trim();
    if (candidate) {
      return candidate;
    }
  }

  const ignoredBlocks = new Set(["Conversation context from previous turns:", "Current user request:"]);
  const blocks = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith("Mode:"))
    .filter((block) => !ignoredBlocks.has(block));

  return blocks.at(-1) ?? trimmed;
}

function parseAgentHistoryEntries(value: unknown): AgentHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: AgentHistoryEntry[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }

    const id =
      (typeof candidate.id === "string" ? candidate.id.trim() : "") ||
      (typeof candidate._id === "string" ? candidate._id.trim() : "");
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";

    if (!id || !prompt || !createdAt) {
      continue;
    }

    items.push({
      id,
      prompt,
      plannerResponse:
        typeof candidate.plannerResponse === "string" ? candidate.plannerResponse : "",
      toolResults: parseToolExecutionItems(candidate.toolResults),
      requiresConfirmation: Boolean(candidate.requiresConfirmation),
      success: Boolean(candidate.success),
      errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
      createdAt,
    });
  }

  return items;
}

function parseNumberCandidate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function parseRagSourceFileItems(value: unknown): RAGSourceFileItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: RAGSourceFileItem[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }

    const fileName = typeof candidate.fileName === "string" ? candidate.fileName.trim() : "";
    if (!fileName) {
      continue;
    }

    const extension = typeof candidate.extension === "string" ? candidate.extension.trim() : "";
    const chunkCount = parseNumberCandidate(candidate.chunkCount);

    items.push({
      fileName,
      extension,
      chunkCount,
    });
  }

  return items;
}

function parseRagRecordList(value: unknown): RAGRecordListItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: RAGRecordListItem[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }

    const id = typeof candidate._id === "string" ? candidate._id.trim() : "";
    const mode = typeof candidate.mode === "string" ? candidate.mode : "";
    if (!id || mode !== "rag") {
      continue;
    }

    const title = typeof candidate.title === "string" ? candidate.title.trim() || null : null;
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
    const provider =
      typeof candidate.provider === "string" ? candidate.provider.trim() || null : null;
    const createdAt =
      typeof candidate.createdAt === "string" ? candidate.createdAt.trim() || null : null;

    items.push({
      id,
      title,
      prompt,
      provider,
      createdAt,
      sourceFiles: parseRagSourceFileItems(candidate.sourceFiles),
    });
  }

  return items;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function renderPersonName(value: unknown): string | null {
  if (typeof value === "string") {
    const direct = value.trim();
    return direct.length > 0 ? direct : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const firstName = toOptionalString(value.firstName);
  const lastName = toOptionalString(value.lastName);
  const fullName = toOptionalString(value.fullName);
  const name = toOptionalString(value.name);

  if (firstName || lastName) {
    return `${firstName ?? ""} ${lastName ?? ""}`.trim();
  }

  return fullName ?? name;
}

function renderPathologies(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (items.length === 0) {
    return null;
  }

  return items.join(", ");
}

function renderEntityIdentifier(value: unknown): string | null {
  return getObjectIdCandidate(value);
}

function renderDateLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return formatDateTime(value);
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

  const fullName = renderPersonName(value);
  if (!fullName) {
    return null;
  }

  const cin = toOptionalString(value.cin) ?? "";
  return cin ? `${fullName} (CIN ${cin})` : fullName;
}

function summarizeSearchPatientResult(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.patients)) {
    return ["Patient search completed."];
  }

  const patients = result.patients.filter((patient): patient is Record<string, unknown> =>
    isRecord(patient),
  );

  const labels = patients.map((patient) => renderPatientLabel(patient)).filter(Boolean) as string[];

  if (labels.length === 0) {
    return ["No patient found matching the query."];
  }

  if (labels.length === 1) {
    const patient = patients[0];
    const details: string[] = [];
    const phone = toOptionalString(patient.phone);
    const email = toOptionalString(patient.email);
    const pathologies = renderPathologies(patient.pathologies);
    const id = renderEntityIdentifier(patient._id) ?? renderEntityIdentifier(patient.id);

    if (phone) {
      details.push(`Phone: ${phone}`);
    }

    if (email) {
      details.push(`Email: ${email}`);
    }

    if (pathologies) {
      details.push(`Pathologies: ${pathologies}`);
    }

    if (id) {
      details.push(`ID: ${id}`);
    }

    return [
      `Patient identified: ${labels[0]}.`,
      ...(details.length > 0 ? [`Details: ${details.join(" | ")}`] : []),
    ];
  }

  const lines = [`Matched ${labels.length} patients:`];
  labels.slice(0, 5).forEach((label) => {
    lines.push(`- ${label}`);
  });

  if (labels.length > 5) {
    lines.push(`- ...and ${labels.length - 5} more.`);
  }

  return lines;
}

function summarizeDoctorsResult(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.doctors)) {
    return ["Doctor listing completed."];
  }

  const doctors = result.doctors.filter((doctor): doctor is Record<string, unknown> => isRecord(doctor));
  if (doctors.length === 0) {
    return ["No doctors found for the requested filters."];
  }

  const lines = [`Doctors found: ${doctors.length}.`];
  doctors.slice(0, 6).forEach((doctor) => {
    const name = renderPersonName(doctor) ?? "Unknown doctor";
    const specialty = toOptionalString(doctor.specialty);
    const id = renderEntityIdentifier(doctor._id) ?? renderEntityIdentifier(doctor.id);
    const status = typeof doctor.isActive === "boolean" ? (doctor.isActive ? "active" : "inactive") : null;

    const detail = [specialty, status].filter(Boolean).join(" | ");
    lines.push(`- ${name}${detail ? ` (${detail})` : ""}${id ? ` | id ${id}` : ""}`);
  });

  if (doctors.length > 6) {
    lines.push(`- ...and ${doctors.length - 6} more.`);
  }

  return lines;
}

function summarizePatientsListResult(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.patients)) {
    return ["Patient listing completed."];
  }

  const patients = result.patients.filter((patient): patient is Record<string, unknown> => isRecord(patient));
  if (patients.length === 0) {
    return ["No patients found."];
  }

  const lines = [`Patients found: ${patients.length}.`];
  patients.slice(0, 6).forEach((patient) => {
    const label = renderPatientLabel(patient) ?? "Unknown patient";
    const pathologies = renderPathologies(patient.pathologies);
    lines.push(`- ${label}${pathologies ? ` | pathologies: ${pathologies}` : ""}`);
  });

  if (patients.length > 6) {
    lines.push(`- ...and ${patients.length - 6} more.`);
  }

  return lines;
}

function summarizeAppointmentEntry(entry: Record<string, unknown>): string {
  const when = renderDateLabel(entry.startAt) ?? renderDateLabel(entry.startAtUtc);
  const status = toOptionalString(entry.status);
  const reason = toOptionalString(entry.reason) ?? toOptionalString(entry.motif);
  const patient = renderPersonName(entry.patientId) ?? renderPersonName(entry.patient) ?? toOptionalString(entry.patientName);
  const doctor = renderPersonName(entry.doctorId) ?? renderPersonName(entry.doctor) ?? toOptionalString(entry.doctorName);

  const segments = [
    when ? `Time: ${when}` : null,
    status ? `Status: ${status}` : null,
    patient ? `Patient: ${patient}` : null,
    doctor ? `Doctor: ${doctor}` : null,
    reason ? `Reason: ${truncateText(reason, 90)}` : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.length > 0 ? segments.join(" | ") : "Appointment details available.";
}

function summarizeAppointmentsResult(result: unknown): string[] {
  const appointments = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.appointments)
      ? result.appointments
      : [];

  const entries = appointments.filter((item): item is Record<string, unknown> => isRecord(item));
  if (entries.length === 0) {
    return ["No appointments found for the selected filters."];
  }

  const lines = [`Appointments found: ${entries.length}.`];
  entries.slice(0, 5).forEach((appointment) => {
    lines.push(`- ${summarizeAppointmentEntry(appointment)}`);
  });

  if (entries.length > 5) {
    lines.push(`- ...and ${entries.length - 5} more.`);
  }

  return lines;
}

function summarizeCheckAvailabilityResult(result: unknown): string[] {
  if (!isRecord(result)) {
    return ["Availability check completed."];
  }

  const isAvailable = typeof result.isAvailable === "boolean" ? result.isAvailable : null;
  const requestedLocal = renderDateLabel(result.requestedStartAtLocal);
  const duration = typeof result.estimatedDurationMinutes === "number" ? result.estimatedDurationMinutes : null;

  const lines = [
    isAvailable === null
      ? "Availability check completed."
      : isAvailable
        ? "Doctor is available at the requested slot."
        : "Doctor is not available at the requested slot.",
    requestedLocal ? `Requested time: ${requestedLocal}.` : null,
    duration ? `Estimated duration: ${duration} minutes.` : null,
  ].filter((line): line is string => Boolean(line));

  const suggestedSlots = Array.isArray(result.suggestedSlots) ? result.suggestedSlots : [];
  const slotLabels = suggestedSlots
    .map((slot) => {
      if (!isRecord(slot)) {
        return null;
      }

      return renderDateLabel(slot.startAtLocal) ?? renderDateLabel(slot.startAtUtc);
    })
    .filter((slot): slot is string => Boolean(slot))
    .slice(0, 4);

  if (slotLabels.length > 0) {
    lines.push(`Suggested slots: ${slotLabels.join(", ")}.`);
  }

  return lines;
}

function summarizePatientSummaryResult(result: unknown): string[] {
  if (!isRecord(result) || !isRecord(result.patient)) {
    return ["Patient summary fetched."];
  }

  const patient = result.patient;
  const patientName = renderPersonName(patient) ?? "Patient";
  const pathologies = renderPathologies(patient.pathologies);
  const lines = [
    `Patient summary for ${patientName}${pathologies ? ` (pathologies: ${pathologies})` : ""}.`,
  ];

  const recentAppointments = Array.isArray(result.recentAppointments) ? result.recentAppointments : [];
  const recentNotes = Array.isArray(result.recentNotes) ? result.recentNotes : [];
  const recentAIRecords = Array.isArray(result.recentAIRecords) ? result.recentAIRecords : [];

  lines.push(
    `Recent activity: appointments ${recentAppointments.length}, notes ${recentNotes.length}, AI records ${recentAIRecords.length}.`,
  );

  if (recentAppointments.length > 0 && isRecord(recentAppointments[0])) {
    lines.push(`Latest appointment: ${summarizeAppointmentEntry(recentAppointments[0])}`);
  }

  if (recentNotes.length > 0 && isRecord(recentNotes[0]) && typeof recentNotes[0].content === "string") {
    lines.push(`Latest note: ${truncateText(normalizeSummaryText(recentNotes[0].content), 140)}`);
  }

  return lines;
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

    const lines = ["Medications found in patient records:", ...medications.map((entry) => `- ${entry}`)];

    const evidence = result.matches
      .slice(0, 2)
      .map((match) => {
        if (!isRecord(match)) {
          return null;
        }

        const metadata = isRecord(match.metadata) ? match.metadata : null;
        return toOptionalString(metadata?.fileName) ?? toOptionalString(match.sourceLabel);
      })
      .filter((label): label is string => Boolean(label));

    if (evidence.length > 0) {
      lines.push(`Evidence sources: ${Array.from(new Set(evidence)).join(", ")}.`);
    }

    return lines;
  }

  const matchCount = result.matches.length;
  if (matchCount === 0) {
    return ["No relevant records were found for this question."];
  }

  const lines = [`Relevant evidence found: ${matchCount} record match${matchCount > 1 ? "es" : ""}.`];
  result.matches.slice(0, 3).forEach((match, index) => {
    if (!isRecord(match) || typeof match.content !== "string") {
      return;
    }

    const metadata = isRecord(match.metadata) ? match.metadata : null;
    const sourceLabel =
      toOptionalString(metadata?.fileName) ??
      toOptionalString(match.sourceLabel) ??
      `source ${index + 1}`;

    lines.push(`- ${sourceLabel}: ${truncateText(normalizeSummaryText(match.content), 180)}`);
  });

  if (typeof result.fallbackUsed === "string") {
    lines.push(`Retrieval mode: ${result.fallbackUsed}.`);
  }

  return lines;
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
    const entries = Array.isArray(value)
      ? value.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
    const length = entries.length;

    if (length > 0) {
      const preview = entries
        .slice(0, 4)
        .map((entry) => renderPersonName(entry) ?? toOptionalString(entry.title) ?? toOptionalString(entry.reason))
        .filter((label): label is string => Boolean(label));

      lines.push(
        preview.length > 0
          ? `${humanizeToolName(key)} (${length}): ${preview.join(", ")}${length > preview.length ? ", ..." : ""}.`
          : `${humanizeToolName(key)} returned ${length} item(s).`,
      );
    } else {
      lines.push(`${humanizeToolName(key)}: 0.`);
    }
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

    switch (item.tool) {
      case "search_patient":
        sectionLines = summarizeSearchPatientResult(item.result);
        break;
      case "search_medical_records_RAG":
        sectionLines = summarizeRagSearchResult(item.result, userPrompt);
        break;
      case "list_doctors":
        sectionLines = summarizeDoctorsResult(item.result);
        break;
      case "list_patients":
        sectionLines = summarizePatientsListResult(item.result);
        break;
      case "list_appointments":
      case "get_day_schedule":
        sectionLines = summarizeAppointmentsResult(item.result);
        break;
      case "check_availability":
        sectionLines = summarizeCheckAvailabilityResult(item.result);
        break;
      case "get_patient_summary":
        sectionLines = summarizePatientSummaryResult(item.result);
        break;
      default:
        sectionLines = summarizeGenericToolResult(item.tool, item.result);
        break;
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
  if (patientName) {
    uniqueLines.unshift(`Answer for ${patientName}:`);
  } else {
    uniqueLines.unshift("Answer:");
  }

  return truncateText(uniqueLines.join("\n"), 2200);
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
  const [ragRetentionPatientId, setRagRetentionPatientId] = useState("");
  const [ragRecords, setRagRecords] = useState<RAGRecordListItem[]>([]);
  const [keptRagRecordIds, setKeptRagRecordIds] = useState<string[]>([]);
  const [ragManagerBusy, setRagManagerBusy] = useState(false);
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

  const loadPersistentHistory = useCallback(async () => {
    const rawEntries = await apiRequest<unknown[]>("/agent/history?limit=40&includeFailures=true");
    const entries = parseAgentHistoryEntries(rawEntries);
    if (entries.length === 0) {
      return;
    }

    const hydratedHistory: HistoryItem[] = [];
    const memoryPayloads: unknown[] = [];

    entries.forEach((entry, index) => {
      const promptText = extractUserRequestFromStoredPrompt(entry.prompt);
      const parsedTimestamp = new Date(entry.createdAt).getTime();
      const createdAt =
        Number.isFinite(parsedTimestamp) && !Number.isNaN(parsedTimestamp)
          ? parsedTimestamp
          : Date.now() - index * 2;

      const promptTitle = /\bmode:\s*insert\b/i.test(entry.prompt)
        ? "Saved insert command"
        : "Saved fetch command";

      hydratedHistory.push({
        id: `persist:prompt:${entry.id}`,
        kind: "prompt",
        title: promptTitle,
        text: promptText || truncateText(normalizeSummaryText(entry.prompt), 700),
        createdAt: createdAt - 1,
      });

      const payloadForHistory: AgentExecutionResult = {
        requiresConfirmation: entry.requiresConfirmation,
        results: entry.toolResults.map((item) => ({
          tool: item.tool,
          args: isRecord(item.args) ? item.args : {},
          result: item.result,
        })),
        finalMessage: entry.errorMessage,
      };

      memoryPayloads.push(payloadForHistory);

      const formattedConversationText = entry.success
        ? formatConversationResultText(payloadForHistory, promptText)
        : null;

      const fallbackSuccessText =
        (toOptionalString(entry.plannerResponse) ?? "Saved execution result.") +
        ` Tool calls: ${entry.toolResults.length}.`;

      hydratedHistory.push({
        id: `persist:result:${entry.id}`,
        kind: entry.success ? "result" : "system",
        title: entry.success ? "Saved execution result" : "Saved execution error",
        text:
          formattedConversationText ??
          entry.errorMessage ??
          (entry.success ? fallbackSuccessText : "Saved execution failed."),
        payload: payloadForHistory,
        createdAt,
      });
    });

    hydratedHistory.sort((left, right) => right.createdAt - left.createdAt);

    setHistory((current) =>
      current.length > 0 ? current : hydratedHistory.slice(0, MAX_HISTORY_ITEMS),
    );

    const extractedEntities = dedupeEntityRefs(
      memoryPayloads.flatMap((payload) => extractEntityRefs(payload)),
    ).slice(0, MAX_ENTITY_MEMORY);

    if (extractedEntities.length > 0) {
      setEntityMemory((current) => (current.length > 0 ? current : extractedEntities));
    }

    showFeedback("info", `Loaded ${entries.length} persisted history record(s).`);
  }, [apiRequest, showFeedback]);

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const user = await apiRequest<AuthUser>("/auth/me");
      setCurrentUser(user);

      try {
        await loadPersistentHistory();
      } catch (historyError) {
        showFeedback(
          "error",
          `Unable to load persisted history: ${extractErrorMessage(historyError)}`,
        );
      }
    } catch (error) {
      clearSession();
      showFeedback("error", extractErrorMessage(error));
    }
  }, [apiRequest, clearSession, loadPersistentHistory, showFeedback, token]);

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

  const handleLoadRagRecords = useCallback(async () => {
    const patientId = ragRetentionPatientId.trim();
    if (!patientId) {
      showFeedback("error", "Patient ID is required to load RAG records.");
      return;
    }

    setRagManagerBusy(true);

    try {
      const query = new URLSearchParams({
        patientId,
        mode: "rag",
        limit: "100",
      });
      const result = await apiRequest<unknown[]>(`/ai/records?${query.toString()}`);
      const parsedRecords = parseRagRecordList(result);

      setRagRecords(parsedRecords);
      setKeptRagRecordIds(parsedRecords.map((record) => record.id));

      if (parsedRecords.length === 0) {
        showFeedback("info", "No active RAG records found for this patient.");
        return;
      }

      showFeedback(
        "success",
        `Loaded ${parsedRecords.length} RAG record(s). Uncheck entries you want to delete, then run cleanup.`,
      );
    } catch (error) {
      showFeedback("error", extractErrorMessage(error));
    } finally {
      setRagManagerBusy(false);
    }
  }, [apiRequest, ragRetentionPatientId, showFeedback]);

  const handleToggleKeptRagRecord = useCallback((recordId: string) => {
    setKeptRagRecordIds((current) => {
      if (current.includes(recordId)) {
        return current.filter((id) => id !== recordId);
      }

      return [...current, recordId];
    });
  }, []);

  const executeRagDeletion = useCallback(
    async (recordIds: string[], label: string) => {
      if (recordIds.length === 0) {
        showFeedback("info", "No RAG records matched this delete action.");
        return;
      }

      setRagManagerBusy(true);

      try {
        const outcomes = await Promise.allSettled(
          recordIds.map((recordId) =>
            apiRequest<null>(`/ai/records/${recordId}`, {
              method: "DELETE",
            }),
          ),
        );

        const deletedIds: string[] = [];
        const failed: Array<{ id: string; message: string }> = [];

        outcomes.forEach((outcome, index) => {
          const targetId = recordIds[index];
          if (!targetId) {
            return;
          }

          if (outcome.status === "fulfilled") {
            deletedIds.push(targetId);
            return;
          }

          failed.push({
            id: targetId,
            message: extractErrorMessage(outcome.reason),
          });
        });

        if (deletedIds.length > 0) {
          const deletedSet = new Set(deletedIds);
          setRagRecords((current) => current.filter((record) => !deletedSet.has(record.id)));
          setKeptRagRecordIds((current) => current.filter((id) => !deletedSet.has(id)));
        }

        const summaryText = `${label}: deleted ${deletedIds.length}/${recordIds.length} record(s).${
          failed.length > 0 ? ` Failed: ${failed.length}.` : ""
        }`;

        pushHistory({
          kind: "result",
          title: "RAG cleanup",
          text: summaryText,
          payload: {
            action: label,
            requested: recordIds,
            deletedIds,
            failed,
          },
        });

        if (failed.length > 0) {
          const preview = failed
            .slice(0, 2)
            .map((item) => `${item.id}: ${item.message}`)
            .join(" | ");
          showFeedback(
            "error",
            `Deleted ${deletedIds.length} record(s), ${failed.length} failed. ${preview}`,
          );
          return;
        }

        showFeedback("success", `Deleted ${deletedIds.length} RAG record(s) successfully.`);
      } finally {
        setRagManagerBusy(false);
      }
    },
    [apiRequest, pushHistory, showFeedback],
  );

  const handleDeleteUncheckedRagRecords = useCallback(async () => {
    const keepSet = new Set(keptRagRecordIds);
    const targetIds = ragRecords
      .filter((record) => !keepSet.has(record.id))
      .map((record) => record.id);

    if (targetIds.length === 0) {
      showFeedback("info", "All loaded RAG records are currently marked to keep.");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete ${targetIds.length} unchecked RAG record(s) and keep ${keepSet.size} checked record(s)?`,
      );
      if (!confirmed) {
        return;
      }
    }

    await executeRagDeletion(targetIds, "delete_unchecked_keep_checked");
  }, [executeRagDeletion, keptRagRecordIds, ragRecords, showFeedback]);

  const handleDeleteCheckedRagRecords = useCallback(async () => {
    const keepSet = new Set(keptRagRecordIds);
    const targetIds = ragRecords
      .filter((record) => keepSet.has(record.id))
      .map((record) => record.id);

    if (targetIds.length === 0) {
      showFeedback("info", "No checked records selected for deletion.");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Delete ${targetIds.length} checked RAG record(s)?`);
      if (!confirmed) {
        return;
      }
    }

    await executeRagDeletion(targetIds, "delete_checked_records");
  }, [executeRagDeletion, keptRagRecordIds, ragRecords, showFeedback]);

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
  const keptRagRecordIdSet = useMemo(() => new Set(keptRagRecordIds), [keptRagRecordIds]);
  const ragRecordsMarkedForDeletion = useMemo(
    () => ragRecords.filter((record) => !keptRagRecordIdSet.has(record.id)).length,
    [keptRagRecordIdSet, ragRecords],
  );
  const ragTotalChunkCount = useMemo(
    () =>
      ragRecords.reduce(
        (sum, record) =>
          sum +
          record.sourceFiles.reduce((innerSum, file) => innerSum + (file.chunkCount ?? 0), 0),
        0,
      ),
    [ragRecords],
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
                    <button
                      type="button"
                      onClick={() => void loadPersistentHistory()}
                      disabled={busy}
                      className="rounded-lg border border-[#cfe2e2] bg-white px-3 py-2 text-xs font-semibold text-[#15414d] disabled:opacity-60"
                    >
                      Load persisted history
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

            <section className="shell-card p-5 sm:p-6">
              <h3 className="text-xl font-semibold text-[#0f3a44]">RAG Retention Manager</h3>
              <p className="mt-2 text-sm text-slate-600">
                Load a patient RAG record set, mark what you want to keep, and delete the rest.
                Deleting a record also removes its indexed vectors from RAG storage.
              </p>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    className="rounded-xl border border-[#cfe2e2] bg-white px-3 py-2 text-sm"
                    placeholder="Patient ID (Mongo ObjectId)"
                    value={ragRetentionPatientId}
                    onChange={(event) => setRagRetentionPatientId(event.target.value)}
                    list="known-patient-ids"
                  />
                  <button
                    type="button"
                    onClick={() => void handleLoadRagRecords()}
                    disabled={busy || ragManagerBusy}
                    className="rounded-xl bg-[#1a56a8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#164b93] disabled:opacity-60"
                  >
                    {ragManagerBusy ? "Loading..." : "Load RAG Records"}
                  </button>
                </div>

                {knownPatients.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstPatient = knownPatients[0];
                      if (!firstPatient) {
                        return;
                      }

                      setRagRetentionPatientId(firstPatient.id);
                    }}
                    className="w-fit rounded-lg border border-[#cfe2e2] bg-[#f6fbfb] px-3 py-2 text-xs font-semibold text-[#15414d]"
                  >
                    Use first remembered patient ID
                  </button>
                )}

                {ragRecords.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No loaded RAG records yet. Provide a patient ID and load records first.
                  </p>
                ) : (
                  <div className="rounded-xl border border-[#d6e6e6] bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pill bg-[#eef7ff] text-[#1a56a8]">
                        {ragRecords.length} loaded
                      </span>
                      <span className="pill bg-[#ecfdf3] text-[#176742]">
                        {keptRagRecordIds.length} marked keep
                      </span>
                      <span className="pill bg-[#fff4e8] text-[#9a4f00]">
                        {ragRecordsMarkedForDeletion} marked delete
                      </span>
                      <span className="pill bg-[#f8fafb] text-slate-600">
                        {ragTotalChunkCount} indexed chunks
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setKeptRagRecordIds(ragRecords.map((record) => record.id))}
                        className="rounded-lg border border-[#cfe2e2] bg-white px-3 py-2 text-xs font-semibold text-[#15414d]"
                      >
                        Keep all
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeptRagRecordIds([])}
                        className="rounded-lg border border-[#e7d8b4] bg-[#fff9ec] px-3 py-2 text-xs font-semibold text-[#7a4f07]"
                      >
                        Mark all for delete
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteUncheckedRagRecords()}
                        disabled={busy || ragManagerBusy || ragRecordsMarkedForDeletion === 0}
                        className="rounded-lg bg-[#9b1c1c] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Delete unchecked (keep checked)
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCheckedRagRecords()}
                        disabled={busy || ragManagerBusy || keptRagRecordIds.length === 0}
                        className="rounded-lg border border-[#ecc7c7] bg-[#fff2f2] px-3 py-2 text-xs font-semibold text-[#9b1c1c] disabled:opacity-60"
                      >
                        Delete checked
                      </button>
                    </div>

                    <div className="mt-3 max-h-[380px] space-y-2 overflow-y-auto pr-1">
                      {ragRecords.map((record) => (
                        <article
                          key={record.id}
                          className="rounded-xl border border-[#d8e8e8] bg-[#fbfefe] p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#15414d]">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-[#accaca]"
                                checked={keptRagRecordIdSet.has(record.id)}
                                onChange={() => handleToggleKeptRagRecord(record.id)}
                              />
                              Keep this record
                            </label>

                            <button
                              type="button"
                              onClick={() => void handleCopyId(record.id)}
                              className="code-text rounded-lg border border-[#cfe2e2] px-2 py-1 text-[11px] text-[#1a56a8]"
                            >
                              copy id
                            </button>
                          </div>

                          <p className="mt-2 text-sm font-semibold text-[#11333f]">
                            {record.title ?? "Untitled RAG record"}
                          </p>
                          <p className="code-text mt-1 text-[11px] text-[#1a56a8]">{record.id}</p>

                          <p className="mt-1 text-xs text-slate-600">
                            Created: {record.createdAt ? formatDateTime(record.createdAt) : "unknown"}
                            {record.provider ? ` | Provider: ${record.provider}` : ""}
                          </p>

                          {record.sourceFiles.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-600">
                              Files: {record.sourceFiles
                                .map((file) =>
                                  `${file.fileName}${
                                    file.chunkCount !== null ? ` (${file.chunkCount} chunks)` : ""
                                  }`,
                                )
                                .join(" | ")}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-500">
                              No uploaded file chunk metadata on this record.
                            </p>
                          )}

                          {record.prompt && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-[#1a56a8]">
                                Prompt preview
                              </summary>
                              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-700">
                                {truncateText(record.prompt, 320)}
                              </p>
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
