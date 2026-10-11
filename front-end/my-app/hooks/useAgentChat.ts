"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AgentConfirmResult, AgentExecutionResult, ApiRequest, PromptMode } from "../lib/types";
import { buildPromptWithMode, createId, extractErrorMessage, sanitizeToolCalls, summarizeConfirmResult, summarizeExecutionResult } from "../lib/utils";
import { buildAgentHistory, ensureConversation } from "../lib/conversations";
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

  const [promptMode, setPromptMode] = useState<PromptMode>("fetch");
  const [maxToolCalls, setMaxToolCalls] = useState(3);
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

    setPromptInput(action.prompt.replaceAll("<PATIENT_ID>", "the relevant patient"));
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

    // History is read before the new message is added, so it holds only earlier messages.
    const history = buildAgentHistory(ensureConversation(conversations, activeConversationKey).messages);

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
      appendMessageToConversation(activeConversationKey, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    promptMode,
    setPromptMode,
    maxToolCalls,
    setMaxToolCalls,
    promptInput,
    setPromptInput,
    chatContainerRef,
    handleNewChat,
    handleQuickAction,
    handleSendPrompt,
    handleConfirmPendingAction,
  };
}
