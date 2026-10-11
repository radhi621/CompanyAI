
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

/**
 * Starting points for common requests. "{patient}" becomes "this patient" in a patient folder
 * and "patient [name]" in the global chat; bracketed parts are for the user to fill in.
 */
export const QUICK_ACTIONS: Array<{ title: string; prompt: string }> = [
  { title: "Today schedule", prompt: "Show today's schedule, grouped by doctor." },
  { title: "List patients", prompt: "List all my patients." },
  { title: "Find by CIN", prompt: "Find the patient with CIN [CIN]." },
  { title: "Patient summary", prompt: "Give me a summary of {patient}." },
  { title: "List appointments", prompt: "List the upcoming appointments of {patient}." },
  { title: "Check availability", prompt: "Is Dr [name] available on [date] at [time]?" },
  { title: "List doctors", prompt: "List all doctors with their specialty." },
  { title: "Uncontacted patients", prompt: "Which patients have not been contacted in the last 30 days?" },
  { title: "Patient notes", prompt: "List the notes of {patient}." },
  { title: "Search medical records", prompt: "What do the uploaded documents of {patient} say about [topic]?" },
  { title: "Search global knowledge", prompt: "What do our medical guidelines say about [topic]?" },
  { title: "Create patient", prompt: "Create a patient: [first name] [last name], CIN [CIN], phone [phone]." },
  { title: "Update patient", prompt: "Change the phone number of {patient} to [phone]." },
  { title: "Create appointment", prompt: "Book {patient} with Dr [name] on [date] at [time] for [reason]." },
  { title: "Cancel appointment", prompt: "Cancel the next appointment of {patient}." },
  { title: "Add patient note", prompt: "Add a note to {patient}: [note]." },
  { title: "Delete patient note", prompt: "Delete the last note of {patient}." },
  { title: "Create doctor profile", prompt: "Create a doctor profile for Dr [name], specialty [specialty], license [number]." },
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
