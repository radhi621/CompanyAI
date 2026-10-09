"use client";

import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { ChatScope, ChatSession, PatientFolder, PromptMode } from "../lib/types";
import { formatDateTime, messageBubbleClass } from "../lib/utils";
import { ControlsIcon, FetchIcon, InsertIcon, QuickActionsIcon, ToolLimitIcon, quickActionIcon } from "../components/icons";

interface ChatPanelProps {
  chatScope: ChatScope;
  activeFolder: PatientFolder | null;
  activeConversation: ChatSession;
  activePendingAction: ChatSession["pendingAction"];
  chatContainerRef: RefObject<HTMLDivElement | null>;
  feedback: string | null;
  busy: boolean;
  canSendPrompt: boolean;
  promptInput: string;
  setPromptInput: Dispatch<SetStateAction<string>>;
  promptMode: PromptMode;
  setPromptMode: Dispatch<SetStateAction<PromptMode>>;
  maxToolCalls: number;
  setMaxToolCalls: Dispatch<SetStateAction<number>>;
  quickActions: Array<{ title: string; mode: PromptMode; prompt: string }>;
  handleQuickAction: (action: { mode: PromptMode; prompt: string }) => void;
  handleSendPrompt: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleConfirmPendingAction: (approved: boolean) => Promise<void>;
  handleNewChat: () => void;
}

/** Main area: conversation header, messages, pending-action confirmation and the prompt composer. */
export default function ChatPanel({
  chatScope,
  activeFolder,
  activeConversation,
  activePendingAction,
  chatContainerRef,
  feedback,
  busy,
  canSendPrompt,
  promptInput,
  setPromptInput,
  promptMode,
  setPromptMode,
  maxToolCalls,
  setMaxToolCalls,
  quickActions,
  handleQuickAction,
  handleSendPrompt,
  handleConfirmPendingAction,
  handleNewChat,
}: ChatPanelProps) {
  return (
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
  );
}
