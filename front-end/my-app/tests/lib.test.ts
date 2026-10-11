import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "../lib/config";
import { buildAgentHistory, MAX_HISTORY_TEXT_LENGTH, MAX_HISTORY_TURNS, parseStoredConversations, parseStoredFolders } from "../lib/conversations";
import { buildPromptWithMode, formatApiErrorMessage, readableAuthError, summarizeExecutionResult } from "../lib/utils";
import { claimWorkspace, releaseWorkspace } from "../lib/workspaceStorage";
import { CONVERSATIONS_STORAGE_KEY, GLOBAL_CONVERSATION_ID, WORKSPACE_OWNER_STORAGE_KEY } from "../lib/config";
import type { ChatMessage } from "../lib/types";

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

  it("names the planned tools when confirmation is needed", () => {
    const text = summarizeExecutionResult({
      requiresConfirmation: true,
      pendingActionId: "a1",
      message: "Confirm deletion.",
      plannedToolCalls: [{ tool: "delete_patient_note", args: {} }],
    });
    expect(text).toBe("Confirm deletion. Planned tools: delete_patient_note.");
  });
});

describe("buildPromptWithMode", () => {
  it("includes the active patient in patient scope", () => {
    const prompt = buildPromptWithMode({
      mode: "fetch",
      prompt: "Summarize",
      scope: "patient",
      folder: { id: "f1", name: "Amrani", patientId: "a".repeat(24), createdAt: 0 },
    });
    expect(prompt).toContain(`Active patientId: ${"a".repeat(24)}`);
    expect(prompt.endsWith("Summarize")).toBe(true);
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

describe("buildAgentHistory", () => {
  const message = (index: number, text = `message ${index}`): ChatMessage => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text,
    createdAt: index,
  });

  it("keeps every earlier message, including the last AI answer", () => {
    const history = buildAgentHistory([message(0), message(1)]);
    expect(history).toEqual([
      { role: "user", text: "message 0" },
      { role: "assistant", text: "message 1" },
    ]);
  });

  it("stays within the backend's limits", () => {
    const messages = Array.from({ length: MAX_HISTORY_TURNS + 20 }, (_, index) => message(index));
    messages[messages.length - 1] = message(999, "x".repeat(MAX_HISTORY_TEXT_LENGTH + 500));

    const history = buildAgentHistory(messages);
    expect(history).toHaveLength(MAX_HISTORY_TURNS);
    expect(history[0].text).toBe("message 20");
    expect(history[history.length - 1].text).toHaveLength(MAX_HISTORY_TEXT_LENGTH);
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
