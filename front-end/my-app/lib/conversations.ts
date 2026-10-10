import type { ChatMessage, ChatScope, ChatSession, ConversationMap, ConversationState, MessageRole, PatientFolder, PendingActionState } from "./types";
import { GLOBAL_CONVERSATION_ID } from "./config";
import { createId, isRecord, sanitizeToolCalls, toOptionalString } from "./utils";

export function createSession(): ChatSession {
  return {
    id: createId("sess"),
    messages: [],
    pendingAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function getEmptyConversation(): ConversationState {
  const session = createSession();
  return {
    activeSessionId: session.id,
    sessions: { [session.id]: session },
  };
}

export function getActiveSession(conversation: ConversationState): ChatSession {
  return conversation.sessions[conversation.activeSessionId] ?? createSession();
}

export function isMessageRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant" || value === "system";
}

export function parseStoredFolders(raw: string | null): PatientFolder[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const id = toOptionalString(item.id);
      const name = toOptionalString(item.name);
      const patientId = toOptionalString(item.patientId);
      const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();

      if (!id || !name || !patientId) {
        return [];
      }

      return [{ id, name, patientId, createdAt }];
    });
  } catch {
    return [];
  }
}

export function parseStoredConversations(raw: string | null): ConversationMap {
  if (!raw) {
    return {
      [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
      };
    }

    const output: ConversationMap = {};

    for (const [conversationId, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }

      // Migrate from old format (single conversation with messages/pendingAction)
      if (Array.isArray(value.messages)) {
        const messages: ChatMessage[] = value.messages.flatMap((item: unknown) => {
          if (!isRecord(item)) return [];
          const id = toOptionalString(item.id);
          const text = toOptionalString(item.text);
          const role = item.role;
          const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
          if (!id || !text || !isMessageRole(role)) return [];
          return [{ id, role, text, createdAt, raw: item.raw }];
        });

        let pendingAction: PendingActionState | null = null;
        if (isRecord(value.pendingAction)) {
          const pendingId = toOptionalString(value.pendingAction.id);
          if (pendingId) {
            pendingAction = {
              id: pendingId,
              expiresAt: toOptionalString(value.pendingAction.expiresAt),
              plannedToolCalls: sanitizeToolCalls(value.pendingAction.plannedToolCalls),
            };
          }
        }

        const sessionId = createId("sess");
        output[conversationId] = {
          activeSessionId: sessionId,
          sessions: {
            [sessionId]: {
              id: sessionId,
              messages,
              pendingAction,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        };
        continue;
      }

      // New format with sessions
      if (isRecord(value.sessions)) {
        const sessions: Record<string, ChatSession> = {};
        for (const [sessionId, sessionValue] of Object.entries(value.sessions)) {
          if (!isRecord(sessionValue)) continue;
          const rawMessages = Array.isArray(sessionValue.messages) ? sessionValue.messages : [];
          const messages: ChatMessage[] = rawMessages.flatMap((item: unknown) => {
            if (!isRecord(item)) return [];
            const id = toOptionalString(item.id);
            const text = toOptionalString(item.text);
            const role = item.role;
            const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
            if (!id || !text || !isMessageRole(role)) return [];
            return [{ id, role, text, createdAt, raw: item.raw }];
          });

          let pendingAction: PendingActionState | null = null;
          if (isRecord(sessionValue.pendingAction)) {
            const pendingId = toOptionalString(sessionValue.pendingAction.id);
            if (pendingId) {
              pendingAction = {
                id: pendingId,
                expiresAt: toOptionalString(sessionValue.pendingAction.expiresAt),
                plannedToolCalls: sanitizeToolCalls(sessionValue.pendingAction.plannedToolCalls),
              };
            }
          }

          sessions[sessionId] = {
            id: sessionId,
            messages,
            pendingAction,
            createdAt: typeof sessionValue.createdAt === "number" ? sessionValue.createdAt : Date.now(),
            updatedAt: typeof sessionValue.updatedAt === "number" ? sessionValue.updatedAt : Date.now(),
          };
        }

        const activeSessionId = toOptionalString(value.activeSessionId);
        const validSessionId = activeSessionId && sessions[activeSessionId] ? activeSessionId : Object.keys(sessions)[0] ?? createId("sess");

        if (!sessions[validSessionId]) {
          const newSession = createSession();
          sessions[newSession.id] = newSession;
          output[conversationId] = { activeSessionId: newSession.id, sessions };
        } else {
          output[conversationId] = { activeSessionId: validSessionId, sessions };
        }
        continue;
      }

      // Fallback: create empty
      output[conversationId] = getEmptyConversation();
    }

    if (!output[GLOBAL_CONVERSATION_ID]) {
      output[GLOBAL_CONVERSATION_ID] = getEmptyConversation();
    }

    return output;
  } catch {
    return {
      [GLOBAL_CONVERSATION_ID]: getEmptyConversation(),
    };
  }
}

export function ensureConversation(map: ConversationMap, id: string | null): ChatSession {
  if (!id) {
    return getActiveSession(getEmptyConversation());
  }

  const conversation = map[id] ?? getEmptyConversation();
  return getActiveSession(conversation);
}

export function getConversationKey(scope: ChatScope, activeFolderId: string | null): string | null {
  if (scope === "global") {
    return GLOBAL_CONVERSATION_ID;
  }

  return activeFolderId;
}

// Limits enforced by the backend's /agent/execute validation.
export const MAX_HISTORY_TURNS = 100;
export const MAX_HISTORY_TEXT_LENGTH = 8000;

/** Earlier messages sent with a prompt: the most recent turns, each trimmed to the backend's limit. */
export function buildAgentHistory(messages: ChatMessage[]): Array<{ role: MessageRole; text: string }> {
  return messages
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => ({ role: message.role, text: message.text.slice(0, MAX_HISTORY_TEXT_LENGTH) }));
}
