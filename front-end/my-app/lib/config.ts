import type { PromptMode } from "./types";

export const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";
export const TOKEN_STORAGE_KEY = "mediassist_access_token";
export const CHAT_SCOPE_STORAGE_KEY = "mediassist_chat_scope_v1";
export const PATIENT_FOLDERS_STORAGE_KEY = "mediassist_patient_folders_v2";
export const ACTIVE_FOLDER_STORAGE_KEY = "mediassist_active_folder_v2";
export const CONVERSATIONS_STORAGE_KEY = "mediassist_conversations_v2";
export const WORKSPACE_OWNER_STORAGE_KEY = "mediassist_workspace_owner_v1";
// A 401 from these means bad credentials or an ended session, not an expired access token.
export const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/refresh", "/auth/logout", "/auth/bootstrap-admin"]);
export const WORKSPACE_STORAGE_KEYS = [
  CHAT_SCOPE_STORAGE_KEY,
  PATIENT_FOLDERS_STORAGE_KEY,
  ACTIVE_FOLDER_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
];
export const GLOBAL_CONVERSATION_ID = "__global__";

export const QUICK_ACTIONS: Array<{ title: string; mode: PromptMode; prompt: string }> = [
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
    title: "Create doctor profile",
    mode: "insert",
    prompt: "Create a doctor profile for <NAME>, specialty <SPECIALTY>, license number <LICENSE>.",
  },
];

export function normalizeApiBaseUrl(rawValue: string | undefined): string {
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

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
