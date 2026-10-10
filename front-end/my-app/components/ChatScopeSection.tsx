"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { ChatScope, ConversationMap, PatientFolder, FolderStats } from "../lib/types";
import { GLOBAL_CONVERSATION_ID } from "../lib/config";
import { formatDateTime } from "../lib/utils";

interface ChatScopeSectionProps {
  chatScope: ChatScope;
  setChatScope: Dispatch<SetStateAction<ChatScope>>;
  conversations: ConversationMap;
  folders: PatientFolder[];
  folderStats: FolderStats[];
  activeFolderId: string | null;
  setActiveFolderId: Dispatch<SetStateAction<string | null>>;
  showFolderForm: boolean;
  setShowFolderForm: Dispatch<SetStateAction<boolean>>;
  newFolderForm: { name: string; patientId: string };
  setNewFolderForm: Dispatch<SetStateAction<{ name: string; patientId: string }>>;
  handleCreateFolder: (event: FormEvent<HTMLFormElement>) => void;
  handleDeleteFolder: (folderId: string) => void;
  handleDeleteSession: (folderId: string, sessionId: string) => void;
  handleSwitchSession: (folderId: string, sessionId: string) => void;
  handleNewChat: () => void;
}

/** Sidebar: switch between global and patient chat, and manage patient folders and sessions. */
export default function ChatScopeSection({
  chatScope,
  setChatScope,
  conversations,
  folders,
  folderStats,
  activeFolderId,
  setActiveFolderId,
  showFolderForm,
  setShowFolderForm,
  newFolderForm,
  setNewFolderForm,
  handleCreateFolder,
  handleDeleteFolder,
  handleDeleteSession,
  handleSwitchSession,
  handleNewChat,
}: ChatScopeSectionProps) {
  return (
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
  );
}
