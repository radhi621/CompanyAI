// Finding the patient a request is about (from tool results, planned calls or the prompt) and
// normalizing record-search calls.
import { type IAgentToolCall } from "../../models/AgentPendingAction";
import { ApiError } from "../../utils/apiError";
import type { ExecutedToolResult } from "./agent.types";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

const OBJECT_ID_GLOBAL_PATTERN = /[a-fA-F0-9]{24}/g;

const PATIENT_ID_HINT_PATTERNS = [
  /-\s*patient:[^\n\r]*?\bid\s*=\s*([a-fA-F0-9]{24})/gi,
  /\bpatientId\b\s*[:=]?\s*([a-fA-F0-9]{24})/gi,
  /\bpatient\b[^\n\r]{0,80}?\b([a-fA-F0-9]{24})\b/gi,
];

// Tools after which an automatic search of the patient's uploaded records can add context
// (open questions about a patient). Any other tool, such as list_patient_notes or
// list_appointments, already answers the request, and searching files would only add noise.
const RECORD_SEARCH_CONTEXT_TOOLS = new Set<string>(["search_patient", "list_patients", "get_patient_summary"]);

export function shouldAutoChainRecordSearch(prompt: string, calls: IAgentToolCall[]): boolean {
  const onlyContextTools = calls.every((call) => RECORD_SEARCH_CONTEXT_TOOLS.has(call.tool));
  const isInsertModePrompt = /\bmode:\s*insert\b/i.test(prompt);

  return onlyContextTools && !isInsertModePrompt;
}

export function normalizePatientId(value: unknown): string | null {
  if (typeof value === "string") {
    return /^[a-fA-F0-9]{24}$/.test(value) ? value : null;
  }

  if (value && typeof value === "object" && "toString" in value) {
    const stringified = (value as { toString: () => string }).toString();
    return /^[a-fA-F0-9]{24}$/.test(stringified) ? stringified : null;
  }

  return null;
}

function collectObjectIdMatches(value: string, pattern: RegExp, captureIndex = 0): string[] {
  const patternWithGlobalFlag = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, patternWithGlobalFlag);
  const matches: string[] = [];
  let current: RegExpExecArray | null;

  while ((current = matcher.exec(value)) !== null) {
    const rawCandidate = captureIndex === 0 ? current[0] : current[captureIndex];
    const normalized = normalizePatientId(rawCandidate);
    if (normalized) {
      matches.push(normalized);
    }
  }

  return matches;
}

function extractPatientIdCandidatesFromPrompt(prompt: string): string[] {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return [];
  }

  const contextualMatches = PATIENT_ID_HINT_PATTERNS.flatMap((pattern) =>
    collectObjectIdMatches(normalizedPrompt, pattern, 1),
  );
  if (contextualMatches.length > 0) {
    return Array.from(new Set(contextualMatches));
  }

  const fallbackMatches = collectObjectIdMatches(normalizedPrompt, OBJECT_ID_GLOBAL_PATTERN);
  if (fallbackMatches.length === 1 && /\bpatient\b/i.test(normalizedPrompt)) {
    return fallbackMatches;
  }

  return [];
}

function extractSinglePatientIdFromSearchResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const payload = result as {
    total?: unknown;
    patients?: Array<Record<string, unknown>>;
  };

  if (!Array.isArray(payload.patients) || payload.patients.length !== 1) {
    return null;
  }

  if (typeof payload.total === "number" && payload.total !== 1) {
    return null;
  }

  return normalizePatientId(payload.patients[0]?._id);
}

function extractPatientIdFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const payload = result as Record<string, unknown>;
  const directPatientId = normalizePatientId(payload.patientId);
  if (directPatientId) {
    return directPatientId;
  }

  const patientObject = payload.patient;
  if (patientObject && typeof patientObject === "object" && !Array.isArray(patientObject)) {
    const nestedPatientId = normalizePatientId((patientObject as Record<string, unknown>)._id);
    if (nestedPatientId) {
      return nestedPatientId;
    }
  }

  return null;
}

export function resolvePatientIdFromExecutionResults(results: ExecutedToolResult[]): string | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const entry = results[index];

    if (entry.tool === "search_patient") {
      const fromSearchResult = extractSinglePatientIdFromSearchResult(entry.result);
      if (fromSearchResult) {
        return fromSearchResult;
      }
    }

    const fromArgs = normalizePatientId(entry.args?.patientId);
    if (fromArgs) {
      return fromArgs;
    }

    const fromResult = extractPatientIdFromToolResult(entry.result);
    if (fromResult) {
      return fromResult;
    }
  }

  return null;
}

function resolvePatientIdFromCalls(calls: IAgentToolCall[]): string | null {
  for (const call of calls) {
    const candidate = normalizePatientId(call.args?.patientId);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function resolvePatientIdForAutoRecordSearch(
  prompt: string,
  calls: IAgentToolCall[],
  executionResults: ExecutedToolResult[],
): string | null {
  const fromResults = resolvePatientIdFromExecutionResults(executionResults);
  if (fromResults) {
    return fromResults;
  }

  const fromCalls = resolvePatientIdFromCalls(calls);
  if (fromCalls) {
    return fromCalls;
  }

  const fromPrompt = extractPatientIdCandidatesFromPrompt(prompt);
  return fromPrompt[0] ?? null;
}

function extractUserQueryFromPrompt(prompt: string): string {
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

  if (blocks.length > 0) {
    return blocks[blocks.length - 1];
  }

  return trimmed;
}

export function buildAutoRecordSearchCall(patientId: string, prompt: string, reason?: string): IAgentToolCall {
  const query = extractUserQueryFromPrompt(prompt).slice(0, 2000);

  return {
    tool: "search_medical_records_RAG",
    args: {
      patientId,
      query,
      limit: 5,
    },
    reason:
      reason ??
      "Auto-chained medical-record retrieval using available patient context for an open-ended request",
  };
}

export function normalizeToolLimit(value: unknown, fallback = 5): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(10, Math.trunc(numeric)));
}

export function normalizeRecordSearchQuery(value: unknown, promptFallback: string): string {
  const raw = typeof value === "string" ? value : promptFallback;
  const extracted = extractUserQueryFromPrompt(raw).trim();
  if (!extracted) {
    return "patient medical records";
  }

  return extracted.slice(0, 2000);
}

export function normalizePlannedToolCalls(prompt: string, calls: IAgentToolCall[]): IAgentToolCall[] {
  const hasPatientSearch = calls.some((call) => call.tool === "search_patient");

  return calls.flatMap((call) => {
    if (call.tool !== "search_medical_records_RAG") {
      return [call];
    }

    const query = normalizeRecordSearchQuery(call.args?.query, prompt);
    const patientId = normalizePatientId(call.args?.patientId);

    if (!patientId && hasPatientSearch) {
      return [];
    }

    if (!patientId || !OBJECT_ID_PATTERN.test(patientId)) {
      throw new ApiError(400, "search_medical_records_RAG requires a valid patientId", {
        tool: call.tool,
        args: call.args,
      });
    }

    return [
      {
        ...call,
        args: {
          ...call.args,
          patientId,
          query,
          limit: normalizeToolLimit(call.args?.limit, 5),
        },
      },
    ];
  });
}
