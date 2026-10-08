"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "../components/Calendar";
import AccountPanel from "../components/AccountPanel";
import AuthScreen from "../components/AuthScreen";
import PatientPanel from "../components/PatientPanel";
import RagUploadPanel from "../components/RagUploadPanel";
import StaffAccountsPanel from "../components/StaffAccountsPanel";
import type { AgentConfirmResult, AgentExecutionResult, ApiEnvelope, AuthUser, ChatMessage, ChatScope, ChatSession, ConversationMap, LoginResponse, PatientFolder, PendingActionState, PromptMode } from "../lib/types";
import { ACTIVE_FOLDER_STORAGE_KEY, CHAT_SCOPE_STORAGE_KEY, CONVERSATIONS_STORAGE_KEY, GLOBAL_CONVERSATION_ID, NO_REFRESH_PATHS, PATIENT_FOLDERS_STORAGE_KEY, QUICK_ACTIONS, TOKEN_STORAGE_KEY, WORKSPACE_OWNER_STORAGE_KEY, WORKSPACE_STORAGE_KEYS, buildApiUrl } from "../lib/config";
import { buildPromptWithMode, createId, extractErrorMessage, formatApiErrorMessage, formatDateTime, messageBubbleClass, readableAuthError, sanitizeToolCalls, summarizeConfirmResult, summarizeExecutionResult } from "../lib/utils";
import { CalendarIcon, ControlsIcon, FetchIcon, InsertIcon, QuickActionsIcon, ScopeIcon, ToolLimitIcon, UploadIcon, UserIcon, quickActionIcon } from "../components/icons";
import { DropdownSection } from "../components/DropdownSection";
import { createSession, ensureConversation, getConversationKey, getEmptyConversation, parseStoredConversations, parseStoredFolders } from "../lib/conversations";

export default function Home() {
  // The access token lives in memory only, so injected scripts cannot read it from storage.
  // After a reload the session is restored through the httpOnly refresh cookie instead.
  const [token, setToken] = useState<string | null>(null);
  const [sessionRestoreDone, setSessionRestoreDone] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [bootstrapForm, setBootstrapForm] = useState({
    bootstrapKey: "",
    name: "",
    email: "",
    password: "",
  });
  // "needed" only on a fresh install with no admin yet; then the setup screen replaces sign-in.
  const [setupStatus, setSetupStatus] = useState<"checking" | "needed" | "done">("checking");
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const [chatScope, setChatScope] = useState<ChatScope>(() => {
    if (typeof window === "undefined") {
      return "global";
    }

    const stored = window.localStorage.getItem(CHAT_SCOPE_STORAGE_KEY);
    return stored === "patient" ? "patient" : "global";
  });

  const [folders, setFolders] = useState<PatientFolder[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    return parseStoredFolders(window.localStorage.getItem(PATIENT_FOLDERS_STORAGE_KEY));
  });

  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const parsedFolders = parseStoredFolders(
      window.localStorage.getItem(PATIENT_FOLDERS_STORAGE_KEY),
    );
    const stored = window.localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY);

    if (stored && parsedFolders.some((folder) => folder.id === stored)) {
      return stored;
    }

    return parsedFolders[0]?.id ?? null;
  });

  const [conversations, setConversations] = useState<ConversationMap>(() => {
    if (typeof window === "undefined") {
      return {
        [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
      };
    }

    return parseStoredConversations(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY));
  });

  const [promptMode, setPromptMode] = useState<PromptMode>("fetch");
  const [maxToolCalls, setMaxToolCalls] = useState(3);
  const [promptInput, setPromptInput] = useState("");

  const [showFolderForm, setShowFolderForm] = useState(false);
  const [newFolderForm, setNewFolderForm] = useState({
    name: "",
    patientId: "",
  });

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

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

  const quickActions = useMemo(() => QUICK_ACTIONS, []);

  interface FolderStats {
    folderId: string;
    totalMessages: number;
    sessionCount: number;
    lastMessageAt: number | undefined;
    sessions: Array<{ id: string; messageCount: number; lastMessageAt: number | undefined; isActive: boolean }>;
  }

  const folderStats: FolderStats[] = useMemo(() => {
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
  }, [conversations, folders]);

  const appendMessageToConversation = useCallback(
    (conversationId: string | null, message: Omit<ChatMessage, "id" | "createdAt">) => {
      if (!conversationId) {
        return;
      }

      setConversations((current) => {
        const conversation = current[conversationId] ?? getEmptyConversation();
        const session = conversation.sessions[conversation.activeSessionId] ?? createSession();
        const newMessage: ChatMessage = { ...message, id: createId("msg"), createdAt: Date.now() };

        return {
          ...current,
          [conversationId]: {
            ...conversation,
            sessions: {
              ...conversation.sessions,
              [session.id]: {
                ...session,
                messages: [...session.messages, newMessage],
                updatedAt: Date.now(),
              },
            },
          },
        };
      });
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

  const clearConversation = useCallback((conversationId: string | null) => {
    if (!conversationId) {
      return;
    }

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

  const clearSession = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setPromptInput("");
    setFeedback(null);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, []);

  // Wipes chats and patient folders, which can contain patient data.
  const resetWorkspace = useCallback(() => {
    setConversations({
      [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
    });
    setFolders([]);
    setActiveFolderId(null);
    setChatScope("global");

    if (typeof window !== "undefined") {
      WORKSPACE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    }
  }, []);

  // Saved chats belong to the user who created them; a different user starts clean.
  const claimWorkspace = useCallback(
    (userId: string) => {
      if (typeof window === "undefined") {
        return;
      }

      const owner = window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY);
      if (owner && owner !== userId) {
        resetWorkspace();
      }

      window.localStorage.setItem(WORKSPACE_OWNER_STORAGE_KEY, userId);
    },
    [resetWorkspace],
  );

  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  // Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers
  // share one request, because the backend rotates (and revokes) the refresh token.
  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          const response = await fetch(buildApiUrl("/auth/refresh"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return null;
          }

          const payload = (await response.json().catch(() => null)) as ApiEnvelope<LoginResponse> | null;
          const nextToken = payload?.data?.accessToken ?? null;
          if (nextToken) {
            setToken(nextToken);
          }

          return nextToken;
        } catch {
          return null;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();
    }

    return refreshPromiseRef.current;
  }, []);

  const apiRequest = useCallback(
    async <T,>(
      path: string,
      options?: RequestInit & {
        idempotencyKey?: string;
      },
    ): Promise<T> => {
      const isFormDataBody =
        typeof FormData !== "undefined" && options?.body instanceof FormData;

      const buildHeaders = (accessToken: string | null): Headers => {
        const headers = new Headers(options?.headers ?? {});

        if (accessToken) {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }

        if (options?.body && !isFormDataBody && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        if (options?.idempotencyKey) {
          headers.set("Idempotency-Key", options.idempotencyKey);
        }

        return headers;
      };

      const requestMethod = options?.method ?? "GET";
      const requestUrl = buildApiUrl(path);

      const send = async (accessToken: string | null): Promise<Response> => {
        try {
          return await fetch(requestUrl, {
            ...options,
            headers: buildHeaders(accessToken),
            credentials: "include",
            cache: "no-store",
          });
        } catch (error) {
          throw new Error(
            `Network error for ${requestMethod} ${requestUrl}: ${extractErrorMessage(error)}`,
          );
        }
      };

      let response = await send(token);

      // Access tokens last 15 minutes: refresh once and retry instead of logging out.
      if (response.status === 401 && token && !NO_REFRESH_PATHS.has(path)) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          response = await send(refreshedToken);
        }
      }

      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

      if (!response.ok) {
        if (response.status === 401 && token) {
          clearSession();
        }

        const baseMessage =
          formatApiErrorMessage(payload) ??
          payload?.message ??
          `Request failed with status ${response.status}`;

        throw new Error(`${baseMessage} | HTTP ${response.status} ${requestMethod} ${requestUrl}`);
      }

      if (!payload) {
        throw new Error(`Empty API response for ${requestMethod} ${requestUrl}`);
      }

      return payload.data;
    },
    [clearSession, refreshAccessToken, token],
  );

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const user = await apiRequest<AuthUser>("/auth/me");
      claimWorkspace(user.id);
      setCurrentUser(user);
    } catch (error) {
      clearSession();
      // An expired or revoked saved session just leads back to sign-in; only explain other
      // failures (such as the backend being unreachable).
      if (!extractErrorMessage(error).includes("| HTTP 401 ")) {
        setFeedback(readableAuthError(error));
      }
    }
  }, [apiRequest, claimWorkspace, clearSession, token]);

  // On first load, try to resume the session from the refresh cookie before showing sign-in.
  useEffect(() => {
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      // Tokens saved by older versions of the app should not linger in storage.
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);

      void refreshAccessToken().finally(() => {
        if (!cancelled) {
          setSessionRestoreDone(true);
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [refreshAccessToken]);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CHAT_SCOPE_STORAGE_KEY, chatScope);
  }, [chatScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PATIENT_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!activeFolderId) {
      window.localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, activeFolderId);
  }, [activeFolderId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [activeConversation.messages]);

  // Ask the backend whether this is a fresh install, to show either first-run setup or sign-in.
  useEffect(() => {
    if (token || !sessionRestoreDone) {
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(buildApiUrl("/auth/setup-status"), { cache: "no-store" });
          const payload = (await response.json().catch(() => null)) as ApiEnvelope<{ needsSetup: boolean }> | null;
          if (!cancelled) {
            setSetupStatus(response.ok && payload?.data?.needsSetup ? "needed" : "done");
          }
        } catch {
          // Backend unreachable: show sign-in, which reports the connection problem on submit.
          if (!cancelled) {
            setSetupStatus("done");
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [sessionRestoreDone, token]);

  const handleBootstrapAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      await apiRequest<AuthUser>("/auth/bootstrap-admin", {
        method: "POST",
        body: JSON.stringify(bootstrapForm),
      });

      // Sign the new admin straight in instead of making them retype their credentials.
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: bootstrapForm.email, password: bootstrapForm.password }),
      });

      claimWorkspace(result.user.id);
      setToken(result.accessToken);
      setCurrentUser(result.user);
      setBootstrapForm({ bootstrapKey: "", name: "", email: "", password: "" });
      setSetupStatus("done");
      setFeedback("Setup complete. Welcome to MediAssist.");
    } catch (error) {
      setFeedback(readableAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });

      claimWorkspace(result.user.id);
      setToken(result.accessToken);
      setCurrentUser(result.user);
      setLoginForm({ email: "", password: "" });
      setFeedback("Welcome back.");
    } catch (error) {
      setFeedback(readableAuthError(error));
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
      // Ignore logout errors and clear local session anyway.
    } finally {
      clearSession();
      resetWorkspace();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(WORKSPACE_OWNER_STORAGE_KEY);
      }
      setBusy(false);
    }
  };

  const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = newFolderForm.name.trim();
    const patientId = newFolderForm.patientId.trim();

    if (!name) {
      setFeedback("Folder name is required.");
      return;
    }

    if (!patientId) {
      setFeedback("Patient ID is required.");
      return;
    }

    if (!/^[a-fA-F0-9]{24}$/.test(patientId)) {
      setFeedback("Patient ID must be a valid 24-character MongoDB ObjectId.");
      return;
    }

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

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete folder '${folder.name}' and its chat history? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
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
    setConversations((current) => {
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
    });
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

  const handleNewChat = () => {
    if (!activeConversationKey) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    clearConversation(activeConversationKey);
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

    const withoutPatientPlaceholder = action.prompt.replaceAll("<PATIENT_ID>", "the relevant patient");
    setPromptInput(withoutPatientPlaceholder);
  };

  const executePrompt = async () => {
    if (!activeConversationKey) {
      setFeedback("Create or select a patient folder first.");
      return;
    }

    if (chatScope === "patient" && !activeFolder) {
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

      const conversation = ensureConversation(conversations, activeConversationKey);
      const history = conversation.messages
        .slice(0, -1)
        .map((msg: ChatMessage) => ({ role: msg.role, text: msg.text }));

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

    const pendingAction = ensureConversation(conversations, activeConversationKey).pendingAction;
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

  if (!token || !currentUser) {
    return (
      <AuthScreen
        setupStatus={setupStatus}
        bootstrapForm={bootstrapForm}
        setBootstrapForm={setBootstrapForm}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        handleBootstrapAdmin={handleBootstrapAdmin}
        handleLogin={handleLogin}
        busy={busy}
        feedback={feedback}
      />
    );
  }

  const activePendingAction = activeConversation.pendingAction;
  const canSendPrompt = chatScope === "global" || (chatScope === "patient" && Boolean(activeFolder));

  return (
    <div className="h-screen overflow-hidden bg-[#f5f1e8] p-3 text-[#2f2a21]">
      <div className="mx-auto flex h-full max-w-[1760px] flex-col gap-3 lg:flex-row">
        <aside className="flex max-h-[46vh] w-full shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-[#ddd2bf] bg-[#f7f2e8] p-2 shadow-[0_6px_18px_rgba(0,0,0,0.05)] lg:max-h-none lg:w-[360px]">
          <div className="rounded-xl border border-[#d8ccb6] bg-[#fffaf1] px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#8a7c62]">Workspace</p>
            <p className="mt-1 text-xs text-[#655842]">
              Active scope: <span className="font-semibold">{chatScope === "global" ? "Global" : "Patient"}</span>
            </p>
            <p className="text-[11px] text-[#81745b]">
              {chatScope === "patient" && activeFolder
                ? `${activeFolder.name} (${activeFolder.patientId})`
                : "Shared global context"}
            </p>
          </div>

          {DropdownSection({
            title: "Chat Scope",
            subtitle: "Switch context and manage patient chat folders",
            icon: ScopeIcon(),
            defaultOpen: true,
            children: (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setChatScope("global")}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                      chatScope === "global"
                        ? "bg-[#2f2a21] text-[#f8f4ec]"
                        : "border border-[#d2c6b1] bg-[#f7f0e4] text-[#665a44]"
                    }`}
                  >
                    Global Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatScope("patient")}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                      chatScope === "patient"
                        ? "bg-[#2f2a21] text-[#f8f4ec]"
                        : "border border-[#d2c6b1] bg-[#f7f0e4] text-[#665a44]"
                    }`}
                  >
                    Patient Chat
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="mt-2 w-full rounded-lg border border-[#cfc2ab] bg-[#fbf7ef] px-3 py-2 text-left text-xs font-medium hover:bg-[#fffaf3]"
                >
                  + New Chat In Current Scope
                </button>

                {chatScope === "global" && (() => {
                  const globalConv = conversations[GLOBAL_CONVERSATION_ID];
                  const globalSessions = globalConv ? Object.values(globalConv.sessions) : [];
                  return globalSessions.length > 1 ? (
                    <div className="mt-2 rounded-lg border border-[#d9ceb9] bg-[#faf6ee] px-2 py-2">
                      <details>
                        <summary className="cursor-pointer text-[10px] text-[#7c6e55]">
                          Global Sessions ({globalSessions.length})
                        </summary>
                        <div className="mt-1 space-y-1">
                          {globalSessions.map((session) => (
                            <div key={session.id} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSwitchSession(GLOBAL_CONVERSATION_ID, session.id)}
                                className={`flex-1 rounded px-2 py-1 text-left text-[10px] ${
                                  session.id === globalConv?.activeSessionId
                                    ? "bg-[#e0d5c0] font-semibold text-[#2f2a21]"
                                    : "text-[#6a5b43] hover:bg-[#efeadc]"
                                }`}
                              >
                                {session.messages.length} msg{session.messages.length !== 1 ? "s" : ""}
                                {session.messages.length > 0
                                  ? ` | ${formatDateTime(session.messages[session.messages.length - 1].createdAt)}`
                                  : " | empty"}
                                {session.id === globalConv?.activeSessionId ? " (active)" : ""}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(GLOBAL_CONVERSATION_ID, session.id)}
                                className="rounded px-1 py-1 text-[10px] text-[#7f3f3f] hover:bg-[#fff1ef]"
                                title="Delete session"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : null;
                })()}

                {chatScope === "patient" && (
                  <>
                    <div className="mt-3 rounded-lg border border-[#dacfbf] bg-[#fffdf7] p-2">
                      <button
                        type="button"
                        onClick={() => setShowFolderForm((current) => !current)}
                        className="w-full rounded-md border border-[#d2c6b1] px-2 py-2 text-[11px] font-medium text-[#6a5b43] hover:bg-[#fff8ed]"
                      >
                        {showFolderForm ? "Hide Create Form" : "Create Patient Folder"}
                      </button>

                      {showFolderForm && (
                        <form className="mt-2 grid gap-2" onSubmit={handleCreateFolder}>
                          <input
                            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                            placeholder="Folder name"
                            value={newFolderForm.name}
                            onChange={(event) =>
                              setNewFolderForm((current) => ({ ...current, name: event.target.value }))
                            }
                            required
                          />
                          <input
                            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
                            placeholder="Patient ID (ObjectId)"
                            value={newFolderForm.patientId}
                            onChange={(event) =>
                              setNewFolderForm((current) => ({ ...current, patientId: event.target.value }))
                            }
                            required
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-[#2f2a21] px-3 py-2 text-xs font-semibold text-[#f8f4ec]"
                          >
                            Create Folder
                          </button>
                        </form>
                      )}
                    </div>

                    <div className="mt-2 max-h-[250px] space-y-2 overflow-y-auto pr-1">
                      {folders.length === 0 && (
                        <p className="rounded-lg border border-dashed border-[#d8ccb6] px-2 py-2 text-xs text-[#8a7c62]">
                          No patient folders yet.
                        </p>
                      )}

                      {folders.map((folder) => {
                        const stats = folderStats.find((entry) => entry.folderId === folder.id);
                        const isActive = folder.id === activeFolderId;

                        return (
                          <div
                            key={folder.id}
                            className={`rounded-lg border px-2 py-2 ${
                              isActive
                                ? "border-[#baab8f] bg-[#fff8ed]"
                                : "border-[#d9ceb9] bg-[#faf6ee]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFolderId(folder.id);
                                setChatScope("patient");
                              }}
                              className="w-full text-left"
                            >
                              <p className="text-xs font-semibold text-[#3c3327]">{folder.name}</p>
                              <p className="mt-1 break-all text-[10px] text-[#7c6e55]">{folder.patientId}</p>
                              <p className="mt-1 text-[10px] text-[#8e7f63]">
                                {stats?.totalMessages ?? 0} messages across {stats?.sessionCount ?? 1} session(s)
                                {stats?.lastMessageAt ? ` | ${formatDateTime(stats.lastMessageAt)}` : ""}
                              </p>
                            </button>

                            {stats && stats.sessions.length > 1 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-[10px] text-[#7c6e55]">
                                  Sessions ({stats.sessions.length})
                                </summary>
                                <div className="mt-1 space-y-1">
                                  {stats.sessions.map((session) => (
                                    <div
                                      key={session.id}
                                      className="flex items-center gap-1"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveFolderId(folder.id);
                                          setChatScope("patient");
                                          handleSwitchSession(folder.id, session.id);
                                        }}
                                        className={`flex-1 rounded px-2 py-1 text-left text-[10px] ${
                                          session.isActive
                                            ? "bg-[#e0d5c0] font-semibold text-[#2f2a21]"
                                            : "text-[#6a5b43] hover:bg-[#efeadc]"
                                        }`}
                                      >
                                        {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
                                        {session.lastMessageAt
                                          ? ` | ${formatDateTime(session.lastMessageAt)}`
                                          : " | empty"}
                                        {session.isActive ? " (active)" : ""}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSession(folder.id, session.id)}
                                        className="rounded px-1 py-1 text-[10px] text-[#7f3f3f] hover:bg-[#fff1ef]"
                                        title="Delete session"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(folder.id)}
                              className="mt-1 rounded-md border border-[#d6c8b1] px-2 py-1 text-[10px] font-medium text-[#7f3f3f] hover:bg-[#fff1ef]"
                            >
                              Delete
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            ),
          })}

          {DropdownSection({
            title: "Calendar",
            subtitle: "Manage appointments",
            icon: CalendarIcon(),
            defaultOpen: false,
            children: (
              <Calendar token={token} refreshAccessToken={refreshAccessToken} isAdmin={currentUser.role === "admin"} />
            ),
          })}

          {DropdownSection({
            title: "Patient Record",
            subtitle: "Patient details, pathologies and notes",
            icon: UserIcon(),
            defaultOpen: false,
            children: (
              <PatientPanel
                request={apiRequest}
                currentUser={currentUser}
                preferredPatientId={chatScope === "patient" ? activeFolder?.patientId : null}
              />
            ),
          })}

          {DropdownSection({
            title: "RAG Upload",
            subtitle: "Switch between global and patient uploads",
            icon: UploadIcon(),
            children: (
              <RagUploadPanel
                apiRequest={apiRequest}
                currentUser={currentUser}
                activeFolder={activeFolder}
                busy={busy}
                setBusy={setBusy}
                setFeedback={setFeedback}
                appendMessageToConversation={appendMessageToConversation}
              />
            ),
          })}

          {currentUser.role === "admin" &&
            DropdownSection({
              title: "Staff Accounts",
              subtitle: "Create, deactivate and reset staff logins (admin only)",
              icon: UserIcon(),
              children: (
                <StaffAccountsPanel
                  apiRequest={apiRequest}
                  currentUser={currentUser}
                  busy={busy}
                  setBusy={setBusy}
                  setFeedback={setFeedback}
                />
              ),
            })}

          {DropdownSection({
            title: "Account",
            subtitle: "Profile and session",
            icon: UserIcon(),
            defaultOpen: true,
            children: (
              <AccountPanel
                apiRequest={apiRequest}
                currentUser={currentUser}
                busy={busy}
                setBusy={setBusy}
                setFeedback={setFeedback}
                handleLogout={handleLogout}
              />
            ),
          })}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[#ddd2bf] bg-[#faf7f0] shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2d8c7] px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[#8e7f63]">MediAssist Conversation</p>
              <h1 className="text-lg font-semibold text-[#2f2a21]">
                {chatScope === "global" ? "Global AI Chat" : "Patient Folder AI Chat"}
              </h1>
              {chatScope === "global" ? (
                <p className="mt-1 text-xs text-[#6f6148]">Using Global Knowledge RAG by default.</p>
              ) : activeFolder ? (
                <p className="mt-1 text-xs text-[#6f6148]">
                  Folder: <span className="font-semibold">{activeFolder.name}</span> | Patient ID: {" "}
                  <span className="font-semibold">{activeFolder.patientId}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-[#8c6a38]">
                  Select a patient folder to use patient-scoped context.
                </p>
              )}
            </div>
          </header>

          {feedback && (
            <div className="border-b border-[#eadfce] bg-[#fff9ee] px-4 py-2 text-sm text-[#745f3e]">{feedback}</div>
          )}

          <div ref={chatContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {activeConversation.messages.length === 0 && (
              <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-[#dfd3bf] bg-white/80 p-6 text-center">
                <h2 className="text-2xl font-semibold text-[#2f2a21]">
                  {chatScope === "global"
                    ? "Ask using global context"
                    : activeFolder
                      ? `Ask about ${activeFolder.name}`
                      : "Select a patient folder first"}
                </h2>
                <p className="mt-2 text-sm text-[#6f6148]">
                  {chatScope === "global"
                    ? "This chat uses Global RAG knowledge by default."
                    : activeFolder
                      ? "This chat uses patient RAG first, then falls back to global RAG when needed."
                      : "Create or choose a patient folder in the left panel to continue."}
                </p>
              </div>
            )}

            {activeConversation.messages.map((message) => (
              <article key={message.id} className="space-y-2">
                <div className={messageBubbleClass(message.role)}>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                </div>
                <div className="px-1 text-[11px] text-[#8f8167]">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </div>
                {message.raw !== undefined && (
                  <details className="rounded-xl border border-[#e4dac9] bg-[#fffdf9] p-2 text-xs text-[#5f523d]">
                    <summary className="cursor-pointer select-none">Technical details (JSON)</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(message.raw, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            ))}
          </div>

          {activePendingAction && (
            <div className="border-t border-[#e3d8c8] bg-[#fff6e6] px-4 py-3">
              <p className="text-sm font-medium text-[#6f4a00]">Pending destructive action</p>
              <p className="mt-1 text-xs text-[#7d6440]">
                ID: {activePendingAction.id}
                {activePendingAction.expiresAt
                  ? ` | Expires: ${formatDateTime(activePendingAction.expiresAt)}`
                  : ""}
              </p>
              {activePendingAction.plannedToolCalls.length > 0 && (
                <p className="mt-1 text-xs text-[#7d6440]">
                  Planned tools: {activePendingAction.plannedToolCalls.map((call) => call.tool).join(", ")}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmPendingAction(true)}
                  className="rounded-lg bg-[#166534] px-3 py-2 text-xs font-semibold text-white"
                  disabled={busy}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPendingAction(false)}
                  className="rounded-lg bg-[#8a1c1c] px-3 py-2 text-xs font-semibold text-white"
                  disabled={busy}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <footer className="border-t border-[#e2d8c7] p-2 sm:p-2.5">
            <form className="space-y-2" onSubmit={handleSendPrompt}>
              <div className="relative rounded-2xl border border-[#d6cab5] bg-white p-2.5 shadow-[0_4px_10px_rgba(0,0,0,0.04)]">
                <textarea
                  value={promptInput}
                  onChange={(event) => setPromptInput(event.target.value)}
                  placeholder={
                    chatScope === "global"
                      ? "Message MediAssist globally..."
                      : activeFolder
                        ? `Message MediAssist for ${activeFolder.name}...`
                        : "Select a patient folder first..."
                  }
                  className="min-h-[52px] w-full resize-y border-0 bg-transparent text-sm leading-6 text-[#2f2a21] outline-none"
                  disabled={!canSendPrompt}
                />

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#eee6d8] pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <details className="group relative">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-[#d9ceb9] bg-[#faf6ee] text-[#6c5e47] hover:bg-white [&::-webkit-details-marker]:hidden">
                        {ControlsIcon()}
                        <span className="sr-only">Open main controls</span>
                      </summary>
                      <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[270px] rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.08)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
                          Main Controls
                        </p>
                        <div className="mt-2 inline-flex rounded-lg border border-[#d2c6b1] bg-[#f6f0e4] p-0.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setPromptMode("fetch")}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                              promptMode === "fetch" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                            }`}
                          >
                            {FetchIcon()}
                            Fetch
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptMode("insert")}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                              promptMode === "insert" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
                            }`}
                          >
                            {InsertIcon()}
                            Insert
                          </button>
                        </div>
                        <label className="mt-2 inline-flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7e7058]">
                          {ToolLimitIcon()}
                          Tool Calls
                          <select
                            value={maxToolCalls}
                            onChange={(event) => setMaxToolCalls(Number(event.target.value))}
                            className="ml-auto rounded-md border border-[#d4c8b3] bg-white px-2 py-1 text-[11px] text-[#2f2a21]"
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                            <option value={5}>5</option>
                          </select>
                        </label>
                      </div>
                    </details>

                    <details className="group relative">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-[#d9ceb9] bg-[#faf6ee] text-[#6c5e47] hover:bg-white [&::-webkit-details-marker]:hidden">
                        {QuickActionsIcon()}
                        <span className="sr-only">Open quick actions</span>
                      </summary>
                      <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[min(78vw,380px)] rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.08)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
                          Quick Actions
                        </p>
                        <div className="mt-2 flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {quickActions.map((item) => (
                            <button
                              key={item.title}
                              type="button"
                              onClick={() => handleQuickAction(item)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#d9ceb9] bg-[#faf6ee] px-2 py-1 text-[11px] font-medium text-[#5f523d] hover:bg-white"
                            >
                              <span className="text-[#6f6148]">{quickActionIcon(item.title)}</span>
                              {item.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="rounded-lg border border-[#d5c8b2] px-3 py-1.5 text-xs font-medium text-[#5f523d] hover:bg-[#f9f3e8]"
                      disabled={!canSendPrompt}
                    >
                      Clear Current Chat
                    </button>

                    <button
                      type="submit"
                      className="rounded-xl bg-[#2f2a21] px-4 py-1.5 text-sm font-medium text-[#f8f5ef] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy || !canSendPrompt}
                    >
                      {busy ? "Working..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </footer>
        </section>
      </div>
    </div>
  );
}
