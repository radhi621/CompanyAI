import { act, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAgentChat } from "../hooks/useAgentChat";
import { useWorkspace } from "../hooks/useWorkspace";
import type { ApiRequest } from "../lib/types";

const PATIENT_ID = "665f1c2a9b3e4d0012345678";
const formEvent = { preventDefault: () => {} } as FormEvent<HTMLFormElement>;

function renderWorkspace(apiRequest: ApiRequest = vi.fn() as unknown as ApiRequest) {
  const setBusy = vi.fn();
  const setFeedback = vi.fn();
  const onDataChanged = vi.fn();
  const hook = renderHook(() => {
    const workspace = useWorkspace(setFeedback);
    const chat = useAgentChat({ apiRequest, workspace, setBusy, setFeedback, onDataChanged });
    return { workspace, chat };
  });
  return { ...hook, setBusy, setFeedback, onDataChanged };
}

function requestBody(apiRequest: ReturnType<typeof vi.fn>, callIndex: number) {
  const options = apiRequest.mock.calls[callIndex][1] as RequestInit;
  return JSON.parse(String(options.body));
}

describe("patient folders", () => {
  it("rejects a patient ID that is not a database ID", () => {
    const { result, setFeedback } = renderWorkspace();

    act(() => result.current.workspace.setNewFolderForm({ name: "Amrani", patientId: "AB123456" }));
    act(() => result.current.workspace.handleCreateFolder(formEvent));

    expect(setFeedback).toHaveBeenLastCalledWith("Patient ID must be a valid 24-character MongoDB ObjectId.");
    expect(result.current.workspace.folders).toHaveLength(0);
  });

  it("creates a folder, switches to it, and reuses it for the same patient", () => {
    const { result, setFeedback } = renderWorkspace();

    act(() => result.current.workspace.setNewFolderForm({ name: " Amrani ", patientId: PATIENT_ID }));
    act(() => result.current.workspace.handleCreateFolder(formEvent));

    expect(result.current.workspace.folders.map((folder) => folder.name)).toEqual(["Amrani"]);
    expect(result.current.workspace.chatScope).toBe("patient");
    expect(result.current.workspace.activeFolder?.patientId).toBe(PATIENT_ID);

    act(() => result.current.workspace.setNewFolderForm({ name: "Duplicate", patientId: PATIENT_ID }));
    act(() => result.current.workspace.handleCreateFolder(formEvent));

    expect(result.current.workspace.folders).toHaveLength(1);
    expect(setFeedback).toHaveBeenLastCalledWith("This patient already has a folder. Switched to it.");
  });

  it("restores folders and chats after a reload", () => {
    const first = renderWorkspace();
    act(() => first.result.current.workspace.setNewFolderForm({ name: "Amrani", patientId: PATIENT_ID }));
    act(() => first.result.current.workspace.handleCreateFolder(formEvent));
    first.unmount();

    const second = renderWorkspace();
    expect(second.result.current.workspace.activeFolder?.name).toBe("Amrani");
    expect(second.result.current.workspace.chatScope).toBe("patient");
  });
});

describe("agent chat", () => {
  it("sends follow-ups in the same conversation, which the backend remembers", async () => {
    const apiRequest = vi.fn(async () => ({
      requiresConfirmation: false,
      finalMessage: `| Name | ID |\n| --- | --- |\n| Amrani | \`${PATIENT_ID}\` |`,
    }));
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("List all patients"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));

    act(() => result.current.chat.setPromptInput("Show the first one"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));

    // Only the typed text is sent, not instructions around it, and both messages share one conversation.
    expect(requestBody(apiRequest, 0)).toEqual({ prompt: "List all patients", conversationId: expect.any(String) });
    expect(requestBody(apiRequest, 1)).toEqual({
      prompt: "Show the first one",
      conversationId: requestBody(apiRequest, 0).conversationId,
    });
    expect(result.current.workspace.activeConversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(result.current.chat.promptInput).toBe("");
  });

  it("keeps the typed prompt and shows the error when the request fails", async () => {
    const apiRequest = vi.fn(async () => {
      throw new Error("AI provider unavailable | HTTP 502 POST /agent/execute");
    });
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("List all patients"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));

    const messages = result.current.workspace.activeConversation.messages;
    expect(messages[messages.length - 1]).toMatchObject({ role: "system", text: expect.stringContaining("unavailable") });
    expect(result.current.chat.promptInput).toBe("List all patients");
  });

  it("asks for confirmation before a destructive action and runs it once approved", async () => {
    const apiRequest = vi.fn(async (path: string) =>
      path === "/agent/execute"
        ? {
            requiresConfirmation: true,
            pendingActionId: "aaaaaaaaaaaaaaaaaaaaaaaa",
            message: "Deleting a note needs confirmation.",
            plannedToolCalls: [{ tool: "delete_patient_note", args: { noteId: "n1" } }],
          }
        : { pendingActionId: "aaaaaaaaaaaaaaaaaaaaaaaa", status: "executed", message: "Note deleted." },
    );
    const { result, onDataChanged } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("Delete note n1"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));
    expect(onDataChanged).not.toHaveBeenCalled();

    expect(result.current.workspace.activeConversation.pendingAction?.plannedToolCalls[0].tool).toBe(
      "delete_patient_note",
    );

    await act(() => result.current.chat.handleConfirmPendingAction(true));

    expect(apiRequest.mock.calls[1][0]).toBe("/agent/actions/aaaaaaaaaaaaaaaaaaaaaaaa/confirm");
    expect(requestBody(apiRequest, 1)).toEqual({ approved: true });
    expect(result.current.workspace.activeConversation.pendingAction).toBeNull();
    // The calendar and patient panel reload after an action ran.
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("removes Approve/Reject when the approved action fails, so it cannot be retried in a loop", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/agent/execute") {
        return { requiresConfirmation: true, pendingActionId: "bbbbbbbbbbbbbbbbbbbbbbbb", message: "Please confirm…" };
      }
      throw new Error("Requested time is outside the doctor's working hours | HTTP 400 POST /agent/actions/b/confirm");
    });
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("Book Leila tomorrow at 7:00"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));
    await act(() => result.current.chat.handleConfirmPendingAction(true));

    expect(result.current.workspace.activeConversation.pendingAction).toBeNull();
    const messages = result.current.workspace.activeConversation.messages;
    expect(messages[messages.length - 1].text).toBe(
      "The action was not completed: Requested time is outside the doctor's working hours",
    );
  });

  it("keeps Approve/Reject after a network error, to try again", async () => {
    const apiRequest = vi.fn(async (path: string) => {
      if (path === "/agent/execute") {
        return { requiresConfirmation: true, pendingActionId: "cccccccccccccccccccccccc", message: "Please confirm…" };
      }
      throw new Error("Failed to fetch");
    });
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("Delete that note"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));
    await act(() => result.current.chat.handleConfirmPendingAction(true));

    expect(result.current.workspace.activeConversation.pendingAction?.id).toBe("cccccccccccccccccccccccc");
  });

  it("sends the folder's patient with each message, and words quick actions for it", async () => {
    const apiRequest = vi.fn(async () => ({ requiresConfirmation: false, finalMessage: "Summary." }));
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.workspace.setNewFolderForm({ name: "Amrani", patientId: PATIENT_ID }));
    act(() => result.current.workspace.handleCreateFolder(formEvent));
    act(() => result.current.chat.handleQuickAction({ prompt: "Give me a summary of {patient}." }));
    expect(result.current.chat.promptInput).toBe("Give me a summary of this patient.");

    await act(() => result.current.chat.handleSendPrompt(formEvent));
    expect(requestBody(apiRequest, 0)).toMatchObject({ prompt: "Give me a summary of this patient.", patientId: PATIENT_ID });
  });

  it("starts a new conversation for a new session", async () => {
    const apiRequest = vi.fn(async () => ({ requiresConfirmation: false, finalMessage: "Hello." }));
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("Hello there"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));
    act(() => result.current.chat.handleNewChat());
    act(() => result.current.chat.setPromptInput("Hello again"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));

    expect(requestBody(apiRequest, 1).conversationId).not.toBe(requestBody(apiRequest, 0).conversationId);
  });

  it("starts a new session but keeps the old one", async () => {
    const apiRequest = vi.fn(async () => ({ requiresConfirmation: false, finalMessage: "Hello." }));
    const { result } = renderWorkspace(apiRequest as unknown as ApiRequest);

    act(() => result.current.chat.setPromptInput("Hello there"));
    await act(() => result.current.chat.handleSendPrompt(formEvent));
    act(() => result.current.chat.handleNewChat());

    expect(result.current.workspace.activeConversation.messages).toHaveLength(0);
    const globalConversation = Object.values(result.current.workspace.conversations)[0];
    expect(Object.keys(globalConversation.sessions)).toHaveLength(2);
  });
});
