"use client";

import type { Dispatch, SetStateAction } from "react";
import Calendar from "./Calendar";
import AccountPanel from "./AccountPanel";
import ChatPanel from "./ChatPanel";
import ChatScopeSection from "./ChatScopeSection";
import PatientPanel from "./PatientPanel";
import RagUploadPanel from "./RagUploadPanel";
import StaffAccountsPanel from "./StaffAccountsPanel";
import { DropdownSection } from "./DropdownSection";
import { CalendarIcon, ScopeIcon, UploadIcon, UserIcon } from "./icons";
import { QUICK_ACTIONS } from "../lib/config";
import type { ApiRequest, AuthUser } from "../lib/types";
import { useWorkspace } from "../hooks/useWorkspace";
import { useAgentChat } from "../hooks/useAgentChat";

interface WorkspaceViewProps {
  token: string;
  currentUser: AuthUser;
  apiRequest: ApiRequest;
  refreshAccessToken: () => Promise<string | null>;
  handleLogout: () => Promise<void>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  feedback: string | null;
  setFeedback: Dispatch<SetStateAction<string | null>>;
}

/** The signed-in app: sidebar panels and the chat. Unmounted on sign-out, which resets its state. */
export default function WorkspaceView({
  token,
  currentUser,
  apiRequest,
  refreshAccessToken,
  handleLogout,
  busy,
  setBusy,
  feedback,
  setFeedback,
}: WorkspaceViewProps) {
  const workspace = useWorkspace(setFeedback);
  const chat = useAgentChat({ apiRequest, workspace, setBusy, setFeedback });

  const { chatScope, activeFolder, activeConversation } = workspace;
  const canSendPrompt = chatScope === "global" || Boolean(activeFolder);

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
              <ChatScopeSection
                chatScope={chatScope}
                setChatScope={workspace.setChatScope}
                conversations={workspace.conversations}
                folders={workspace.folders}
                folderStats={workspace.folderStats}
                activeFolderId={workspace.activeFolderId}
                setActiveFolderId={workspace.setActiveFolderId}
                showFolderForm={workspace.showFolderForm}
                setShowFolderForm={workspace.setShowFolderForm}
                newFolderForm={workspace.newFolderForm}
                setNewFolderForm={workspace.setNewFolderForm}
                handleCreateFolder={workspace.handleCreateFolder}
                handleDeleteFolder={workspace.handleDeleteFolder}
                handleDeleteSession={workspace.handleDeleteSession}
                handleSwitchSession={workspace.handleSwitchSession}
                handleNewChat={chat.handleNewChat}
              />
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
                appendMessageToConversation={workspace.appendMessageToConversation}
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

        <ChatPanel
          chatScope={chatScope}
          activeFolder={activeFolder}
          activeConversation={activeConversation}
          activePendingAction={activeConversation.pendingAction}
          chatContainerRef={chat.chatContainerRef}
          feedback={feedback}
          busy={busy}
          canSendPrompt={canSendPrompt}
          promptInput={chat.promptInput}
          setPromptInput={chat.setPromptInput}
          promptMode={chat.promptMode}
          setPromptMode={chat.setPromptMode}
          maxToolCalls={chat.maxToolCalls}
          setMaxToolCalls={chat.setMaxToolCalls}
          quickActions={QUICK_ACTIONS}
          handleQuickAction={chat.handleQuickAction}
          handleSendPrompt={chat.handleSendPrompt}
          handleConfirmPendingAction={chat.handleConfirmPendingAction}
          handleNewChat={chat.handleNewChat}
        />
      </div>
    </div>
  );
}
