"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useState } from "react";
import type { ApiRequest, AuthUser, ChatMessage, PatientFolder, RagUploadMode } from "../lib/types";
import { GLOBAL_CONVERSATION_ID } from "../lib/config";
import { extractErrorMessage } from "../lib/utils";

interface RagUploadPanelProps {
  apiRequest: ApiRequest;
  currentUser: AuthUser;
  activeFolder: PatientFolder | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<string | null>>;
  appendMessageToConversation: (conversationId: string | null, message: Omit<ChatMessage, "id" | "createdAt">) => void;
}

export default function RagUploadPanel({
  apiRequest,
  currentUser,
  activeFolder,
  busy,
  setBusy,
  setFeedback,
  appendMessageToConversation,
}: RagUploadPanelProps) {
  const [globalRagFiles, setGlobalRagFiles] = useState<File[]>([]);
  const [globalRagNote, setGlobalRagNote] = useState("");

  const [patientRagFiles, setPatientRagFiles] = useState<File[]>([]);
  const [patientRagPrompt, setPatientRagPrompt] = useState("");
  const [ragUploadMode, setRagUploadMode] = useState<RagUploadMode>("global");

  const handleUploadGlobalRag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (currentUser?.role !== "admin") {
      setFeedback("Global RAG upload is restricted to admin.");
      return;
    }

    if (globalRagFiles.length === 0) {
      setFeedback("Select at least one global RAG file.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      if (globalRagNote.trim()) {
        formData.append("note", globalRagNote.trim());
      }

      globalRagFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await apiRequest<unknown>("/ai/global/upload", {
        method: "POST",
        body: formData,
      });

      appendMessageToConversation(GLOBAL_CONVERSATION_ID, {
        role: "assistant",
        text: `Indexed ${globalRagFiles.length} global RAG file(s) successfully.`,
        raw: result,
      });

      setGlobalRagFiles([]);
      setGlobalRagNote("");
      setFeedback("Global RAG upload completed.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
      appendMessageToConversation(GLOBAL_CONVERSATION_ID, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUploadPatientRag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeFolder) {
      setFeedback("Select a patient folder first.");
      return;
    }

    if (patientRagFiles.length === 0) {
      setFeedback("Select at least one patient RAG file.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append("patientId", activeFolder.patientId);
      formData.append("mode", "rag");

      if (patientRagPrompt.trim()) {
        formData.append("prompt", patientRagPrompt.trim());
      }

      patientRagFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await apiRequest<unknown>("/ai/records/upload", {
        method: "POST",
        body: formData,
      });

      appendMessageToConversation(activeFolder.id, {
        role: "assistant",
        text: `Indexed ${patientRagFiles.length} patient RAG file(s) for ${activeFolder.name}.`,
        raw: result,
      });

      setPatientRagFiles([]);
      setPatientRagPrompt("");
      setFeedback("Patient RAG upload completed.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
      appendMessageToConversation(activeFolder.id, {
        role: "system",
        text: extractErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        if (ragUploadMode === "global") {
          void handleUploadGlobalRag(event);
          return;
        }

        void handleUploadPatientRag(event);
      }}
    >
      <div className="inline-flex rounded-lg border border-[#d2c6b1] bg-[#f6f0e4] p-1 text-xs">
        <button
          type="button"
          onClick={() => setRagUploadMode("global")}
          className={`rounded-md px-2 py-1 ${
            ragUploadMode === "global" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
          }`}
        >
          Global
        </button>
        <button
          type="button"
          onClick={() => setRagUploadMode("patient")}
          className={`rounded-md px-2 py-1 ${
            ragUploadMode === "patient" ? "bg-white text-[#2f2a21]" : "text-[#7e715b]"
          }`}
        >
          Patient
        </button>
      </div>

      {ragUploadMode === "patient" && (
        <div className="rounded-lg border border-[#d7ccb8] bg-[#fffdf8] px-2 py-2 text-[11px] text-[#615338]">
          Active patient: {activeFolder ? `${activeFolder.name} (${activeFolder.patientId})` : "None"}
        </div>
      )}

      <textarea
        className="min-h-[56px] rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
        placeholder={
          ragUploadMode === "global" ? "Optional note" : "Optional prompt for parsing context"
        }
        value={ragUploadMode === "global" ? globalRagNote : patientRagPrompt}
        onChange={(event) => {
          if (ragUploadMode === "global") {
            setGlobalRagNote(event.target.value);
            return;
          }

          setPatientRagPrompt(event.target.value);
        }}
        disabled={ragUploadMode === "patient" && !activeFolder}
      />

      <input
        type="file"
        multiple
        onChange={(event) => {
          if (ragUploadMode === "global") {
            setGlobalRagFiles(Array.from(event.target.files ?? []));
            return;
          }

          setPatientRagFiles(Array.from(event.target.files ?? []));
        }}
        className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
        disabled={ragUploadMode === "patient" && !activeFolder}
      />

      <button
        type="submit"
        className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
          ragUploadMode === "global" ? "bg-[#0f5a4f]" : "bg-[#1c4f8c]"
        }`}
        disabled={
          busy ||
          (ragUploadMode === "global" ? currentUser.role !== "admin" : !activeFolder)
        }
      >
        {busy
          ? "Uploading..."
          : ragUploadMode === "global"
            ? "Upload Global RAG"
            : "Upload Patient RAG"}
      </button>

      {ragUploadMode === "global" && currentUser.role !== "admin" && (
        <p className="text-[11px] text-[#8d6b35]">Only admin can upload global knowledge.</p>
      )}
    </form>
  );
}
