"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatScope, ChatSession, ConversationMap, FolderStats, PatientFolder, PendingActionState } from "../lib/types";
import { ACTIVE_FOLDER_STORAGE_KEY, CHAT_SCOPE_STORAGE_KEY, CONVERSATIONS_STORAGE_KEY, PATIENT_FOLDERS_STORAGE_KEY } from "../lib/config";
import { createId } from "../lib/utils";
import { createSession, ensureConversation, getConversationKey, getEmptyConversation, parseStoredConversations, parseStoredFolders } from "../lib/conversations";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

function readStorage(key: string): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(key);
}

/** Validates the new-folder form; returns an error message or null when it is valid. */
export function validateNewFolder(form: { name: string; patientId: string }): string | null {
  if (!form.name.trim()) {
    return "Folder name is required.";
  }

  const patientId = form.patientId.trim();
  if (!patientId) {
    return "Patient ID is required.";
  }

  if (!OBJECT_ID_PATTERN.test(patientId)) {
    return "Patient ID must be a valid 24-character MongoDB ObjectId.";
  }

  return null;
}

/** Adds a message to the active session of a conversation. */
export function appendMessage(
  current: ConversationMap,
  conversationId: string,
  message: ChatMessage,
): ConversationMap {
  const conversation = current[conversationId] ?? getEmptyConversation();
  const session = conversation.sessions[conversation.activeSessionId] ?? createSession();

  return {
    ...current,
    [conversationId]: {
      ...conversation,
      sessions: {
        ...conversation.sessions,
        [session.id]: {
          ...session,
          messages: [...session.messages, message],
          updatedAt: Date.now(),
        },
      },
    },
  };
}

/** Removes a session; the last remaining session of a folder is kept. */
export function removeSession(current: ConversationMap, folderId: string, sessionId: string): ConversationMap {
  const conversation = current[folderId];
  if (!conversation || !conversation.sessions[sessionId]) {
    return current;
  }

  const remaining = Object.keys(conversation.sessions).filter((id) => id !== sessionId);
  if (remaining.length === 0) {
    return current;
  }

  const newSessions: Record<string, ChatSession> = {};
  for (const id of remaining) {
    newSessions[id] = conversation.sessions[id];
  }

  const wasActive = conversation.activeSessionId === sessionId;
  return {
    ...current,
    [folderId]: {
      ...conversation,
      activeSessionId: wasActive ? remaining[remaining.length - 1] : conversation.activeSessionId,
      sessions: newSessions,
    },
  };
}

/** Per-folder message and session counts for the sidebar. */
export function computeFolderStats(folders: PatientFolder[], conversations: ConversationMap): FolderStats[] {
  return folders.map((folder) => {
    const conversation = conversations[folder.id] ?? getEmptyConversation();
    const sessionList = Object.values(conversation.sessions);
    let totalMessages = 0;
    let lastMessageAt: number | undefined;
    const sessions = sessionList.map((session) => {
      const msgCount = session.messages.length;
      totalMessages += msgCount;
      const last = session.messages[session.messages.length - 1];
      const lastAt = last?.createdAt;
      if (lastAt && (!lastMessageAt || lastAt > lastMessageAt)) {
        lastMessageAt = lastAt;
      }
      return {
        id: session.id,
        messageCount: msgCount,
        lastMessageAt: lastAt,
        isActive: session.id === conversation.activeSessionId,
      };
    });

    return {
      folderId: folder.id,
      totalMessages,
      sessionCount: sessionList.length,
      lastMessageAt,
      sessions,
    };
  });
}

/**
 * Chat scope, patient folders and their conversations, saved in this browser's storage.
 * Mounted only while someone is signed in, after the workspace has been claimed for them.
 */
export function useWorkspace(setFeedback: (feedback: string | null) => void) {
  const [chatScope, setChatScope] = useState<ChatScope>(() =>
    readStorage(CHAT_SCOPE_STORAGE_KEY) === "patient" ? "patient" : "global",
  );

  const [folders, setFolders] = useState<PatientFolder[]>(() =>
    parseStoredFolders(readStorage(PATIENT_FOLDERS_STORAGE_KEY)),
  );

  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => {
    const parsedFolders = parseStoredFolders(readStorage(PATIENT_FOLDERS_STORAGE_KEY));
    const stored = readStorage(ACTIVE_FOLDER_STORAGE_KEY);

    if (stored && parsedFolders.some((folder) => folder.id === stored)) {
      return stored;
    }

    return parsedFolders[0]?.id ?? null;
  });

  const [conversations, setConversations] = useState<ConversationMap>(() =>
    parseStoredConversations(readStorage(CONVERSATIONS_STORAGE_KEY)),
  );

  const [showFolderForm, setShowFolderForm] = useState(false);
  const [newFolderForm, setNewFolderForm] = useState({ name: "", patientId: "" });

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === activeFolderId) ?? null,
    [activeFolderId, folders],
  );

  const activeConversationKey = useMemo(
    () => getConversationKey(chatScope, activeFolderId),
    [chatScope, activeFolderId],
  );

  const activeConversation = useMemo(
    () => ensureConversation(conversations, activeConversationKey),
    [activeConversationKey, conversations],
  );

  const folderStats = useMemo(() => computeFolderStats(folders, conversations), [conversations, folders]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_SCOPE_STORAGE_KEY, chatScope);
  }, [chatScope]);

  useEffect(() => {
    window.localStorage.setItem(PATIENT_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (!activeFolderId) {
      window.localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, activeFolderId);
  }, [activeFolderId]);

  useEffect(() => {
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  const appendMessageToConversation = useCallback(
    (conversationId: string | null, message: Omit<ChatMessage, "id" | "createdAt">) => {
      if (!conversationId) {
        return;
      }

      const newMessage: ChatMessage = { ...message, id: createId("msg"), createdAt: Date.now() };
      setConversations((current) => appendMessage(current, conversationId, newMessage));
    },
    [],
  );

  const setPendingActionForConversation = useCallback(
    (conversationId: string | null, pendingAction: PendingActionState | null) => {
      if (!conversationId) {
        return;
      }

      setConversations((current) => {
        const conversation = current[conversationId] ?? getEmptyConversation();
        const session = conversation.sessions[conversation.activeSessionId] ?? createSession();

        return {
          ...current,
          [conversationId]: {
            ...conversation,
            sessions: {
              ...conversation.sessions,
              [session.id]: {
                ...session,
                pendingAction,
                updatedAt: Date.now(),
              },
            },
          },
        };
      });
    },
    [],
  );

  // Starts a new session; previous sessions are kept.
  const startNewSession = useCallback((conversationId: string) => {
    setConversations((current) => {
      const conversation = current[conversationId] ?? getEmptyConversation();
      const newSession = createSession();

      return {
        ...current,
        [conversationId]: {
          ...conversation,
          activeSessionId: newSession.id,
          sessions: {
            ...conversation.sessions,
            [newSession.id]: newSession,
          },
        },
      };
    });
  }, []);

  const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = validateNewFolder(newFolderForm);
    if (validationError) {
      setFeedback(validationError);
      return;
    }

    const name = newFolderForm.name.trim();
    const patientId = newFolderForm.patientId.trim();

    const duplicate = folders.find((folder) => folder.patientId === patientId);
    if (duplicate) {
      setActiveFolderId(duplicate.id);
      setChatScope("patient");
      setFeedback("This patient already has a folder. Switched to it.");
      return;
    }

    const created: PatientFolder = {
      id: createId("folder"),
      name,
      patientId,
      createdAt: Date.now(),
    };

    setFolders((current) => [created, ...current]);
    setConversations((current) => ({
      ...current,
      [created.id]: getEmptyConversation(),
    }));
    setActiveFolderId(created.id);
    setChatScope("patient");
    setShowFolderForm(false);
    setNewFolderForm({ name: "", patientId: "" });
    setFeedback("Patient folder created.");
  };

  const handleDeleteFolder = (folderId: string) => {
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) {
      return;
    }

    const confirmed = window.confirm(
      `Delete folder '${folder.name}' and its chat history? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    const remainingFolders = folders.filter((entry) => entry.id !== folderId);

    setFolders(remainingFolders);
    setConversations((current) => {
      const next = { ...current };
      delete next[folderId];
      return next;
    });

    if (activeFolderId === folderId) {
      const nextActiveId = remainingFolders[0]?.id ?? null;
      setActiveFolderId(nextActiveId);
      if (!nextActiveId) {
        setChatScope("global");
      }
    }

    setFeedback("Folder deleted.");
  };

  const handleDeleteSession = (folderId: string, sessionId: string) => {
    setConversations((current) => removeSession(current, folderId, sessionId));
  };

  const handleSwitchSession = (folderId: string, sessionId: string) => {
    setConversations((current) => {
      const conversation = current[folderId];
      if (!conversation || !conversation.sessions[sessionId]) {
        return current;
      }
      return {
        ...current,
        [folderId]: {
          ...conversation,
          activeSessionId: sessionId,
        },
      };
    });
  };

  return {
    chatScope,
    setChatScope,
    folders,
    folderStats,
    conversations,
    activeFolderId,
    setActiveFolderId,
    activeFolder,
    activeConversationKey,
    activeConversation,
    showFolderForm,
    setShowFolderForm,
    newFolderForm,
    setNewFolderForm,
    appendMessageToConversation,
    setPendingActionForConversation,
    startNewSession,
    handleCreateFolder,
    handleDeleteFolder,
    handleDeleteSession,
    handleSwitchSession,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
