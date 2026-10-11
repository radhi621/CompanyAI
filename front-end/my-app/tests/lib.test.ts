import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "../lib/config";
import { parseStoredConversations, parseStoredFolders } from "../lib/conversations";
import { formatApiErrorMessage, readableAuthError, summarizeExecutionResult } from "../lib/utils";
import { claimWorkspace, releaseWorkspace } from "../lib/workspaceStorage";
import { CONVERSATIONS_STORAGE_KEY, GLOBAL_CONVERSATION_ID, WORKSPACE_OWNER_STORAGE_KEY } from "../lib/config";

describe("normalizeApiBaseUrl", () => {
  it("falls back to the default when unset", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("http://localhost:4000/api/v1");
  });

  it("adds /api/v1 to a bare origin and strips trailing slashes", () => {
    expect(normalizeApiBaseUrl("https://api.example.com")).toBe("https://api.example.com/api/v1");
    expect(normalizeApiBaseUrl("https://api.example.com/api/v1///")).toBe("https://api.example.com/api/v1");
  });
});

describe("error messages", () => {
  it("lists field errors from a validation response", () => {
    const message = formatApiErrorMessage({
      message: "Validation error",
      issues: { fieldErrors: { email: ["Invalid email"], password: [] } },
    });
    expect(message).toBe("Validation error | email: Invalid email");
  });

  it("drops the debugging suffix on the sign-in screen", () => {
    expect(readableAuthError(new Error("Invalid credentials | HTTP 401 POST http://x/auth/login"))).toBe(
      "Invalid credentials",
    );
  });

  it("explains an unreachable backend", () => {
    expect(readableAuthError(new Error("Network error for POST http://x: Failed to fetch"))).toMatch(
      /^Cannot reach the server at .+ Is the backend running\?$/,
    );
  });
});

describe("summarizeExecutionResult", () => {
  it("prefers the final AI answer", () => {
    expect(summarizeExecutionResult({ requiresConfirmation: false, finalMessage: "Two patients.", message: "Done" })).toBe(
      "Two patients.",
    );
  });

  it("shows the confirmation message, which names the action, when approval is needed", () => {
    const text = summarizeExecutionResult({
      requiresConfirmation: true,
      pendingActionId: "a1",
      message: "Please confirm before anything is changed:\n- **Delete note**: noteId `n1`",
      plannedToolCalls: [{ tool: "delete_patient_note", args: {} }],
    });
    expect(text).toBe("Please confirm before anything is changed:\n- **Delete note**: noteId `n1`");
  });
});

describe("stored workspace parsing", () => {
  it("ignores corrupted storage", () => {
    expect(parseStoredFolders("not json")).toEqual([]);
    expect(Object.keys(parseStoredConversations("{broken"))).toEqual([GLOBAL_CONVERSATION_ID]);
  });

  it("drops folders missing required fields", () => {
    const folders = parseStoredFolders(
      JSON.stringify([{ id: "f1", name: "Ok", patientId: "p1", createdAt: 1 }, { id: "f2", name: "No patient" }]),
    );
    expect(folders.map((folder) => folder.id)).toEqual(["f1"]);
  });

  it("migrates the old single-conversation format into a session", () => {
    const parsed = parseStoredConversations(
      JSON.stringify({
        [GLOBAL_CONVERSATION_ID]: {
          messages: [{ id: "m1", role: "user", text: "hello", createdAt: 1 }],
          pendingAction: null,
        },
      }),
    );
    const conversation = parsed[GLOBAL_CONVERSATION_ID];
    expect(conversation.sessions[conversation.activeSessionId].messages.map((m) => m.text)).toEqual(["hello"]);
  });
});

describe("workspace ownership", () => {
  it("keeps the saved chats for the same user", () => {
    claimWorkspace("user-a");
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, "saved");
    claimWorkspace("user-a");
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBe("saved");
  });

  it("clears another user's saved chats", () => {
    claimWorkspace("user-a");
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, "patient data");
    claimWorkspace("user-b");
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY)).toBe("user-b");
  });

  it("clears everything on sign-out", () => {
    claimWorkspace("user-a");
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, "patient data");
    releaseWorkspace();
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY)).toBeNull();
  });
});
