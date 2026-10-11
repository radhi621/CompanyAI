"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AgentConfirmResult, AgentExecutionResult, ApiRequest } from "../lib/types";
import { createId, extractErrorMessage, httpStatusOf, readableApiError, sanitizeToolCalls, summarizeConfirmResult, summarizeExecutionResult } from "../lib/utils";
import { ensureConversation } from "../lib/conversations";
import type { Workspace } from "./useWorkspace";

interface UseAgentChatOptions {
  apiRequest: ApiRequest;
  workspace: Workspace;
  setBusy: (busy: boolean) => void;
  setFeedback: (feedback: string | null) => void;
}

/** The prompt composer and the calls to the AI agent for the active conversation. */
export function useAgentChat({ apiRequest, workspace, setBusy, setFeedback }: UseAgentChatOptions) {
  const {
    chatScope,
    activeFolder,
    activeConversationKey,
    activeConversation,
    conversations,
    appendMessageToConversation,
    setPendingActionForConversation,
    startNewSession,
  } = workspace;

  const [promptInput, setPromptInput] = useState("");

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [activeConversation.messages]);

  const handleNewChat = () => {
    if (!activeConversationKey) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    startNewSession(activeConversationKey);
    setPromptInput("");
    setFeedback("Started a new session. Previous sessions are preserved.");
  };

  const handleQuickAction = (action: { prompt: string }) => {
    if (chatScope === "patient" && !activeFolder) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    setPromptInput(action.prompt.replaceAll("{patient}", chatScope === "patient" ? "this patient" : "patient [name]"));
  };

  const executePrompt = async () => {
    if (!activeConversationKey || (chatScope === "patient" && !activeFolder)) {
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

    // The backend keeps the conversation (with the tools' results) under the session's ID.
    const conversationId = ensureConversation(conversations, activeConversationKey).id;

    appendMessageToConversation(activeConversationKey, {
      role: "user",
      text: trimmed,
    });

    try {
      const result = await apiRequest<AgentExecutionResult>("/agent/execute", {
        method: "POST",
        body: JSON.stringify({
          prompt: trimmed,
          conversationId,
          ...(chatScope === "patient" && activeFolder ? { patientId: activeFolder.patientId } : {}),
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

    const pendingAction = activeConversation.pendingAction;
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
      // Any answer from the server settles the action (it failed, was already handled, expired
      // or is not this user's), so the Approve/Reject box goes away. Only a network failure or
      // a rate limit leaves it open to try again.
      const status = httpStatusOf(error);
      const settled = status !== null && status !== 429;
      appendMessageToConversation(activeConversationKey, {
        role: "system",
        text: settled
          ? `The action was not completed: ${readableApiError(error)}`
          : extractErrorMessage(error),
      });
      if (settled) {
        setPendingActionForConversation(activeConversationKey, null);
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    promptInput,
    setPromptInput,
    chatContainerRef,
    handleNewChat,
    handleQuickAction,
    handleSendPrompt,
    handleConfirmPendingAction,
  };
}
