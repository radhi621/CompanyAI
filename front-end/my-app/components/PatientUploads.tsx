"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import type { ApiRequest, AuthUser, PatientFolder, PatientUpload } from "../lib/types";
import { canModifyUpload, extractErrorMessage, formatDateTime, formatFileSize } from "../lib/utils";

interface PatientUploadsProps {
  apiRequest: ApiRequest;
  currentUser: AuthUser;
  folder: PatientFolder;
  /** Changes after a new upload, so the list reloads. */
  refreshKey: number;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<string | null>>;
}

interface LoadedUploads {
  key: string;
  uploads: PatientUpload[];
  error: string | null;
}

function fileNames(upload: PatientUpload): string {
  return upload.sourceFiles.map((file) => file.fileName).join(", ");
}

/** The files uploaded for one patient, with delete and replace. */
export default function PatientUploads({
  apiRequest,
  currentUser,
  folder,
  refreshKey,
  busy,
  setBusy,
  setFeedback,
}: PatientUploadsProps) {
  const [reloadCount, setReloadCount] = useState(0);
  const [loaded, setLoaded] = useState<LoadedUploads | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = useRef<PatientUpload | null>(null);

  const loadKey = `${folder.patientId}:${refreshKey}:${reloadCount}`;
  const loading = loaded?.key !== loadKey;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const query = new URLSearchParams({ patientId: folder.patientId, hasFiles: "true", limit: "50" });
        const uploads = await apiRequest<PatientUpload[]>(`/ai/records?${query.toString()}`);
        if (!cancelled) {
          setLoaded({ key: loadKey, uploads, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setLoaded({ key: loadKey, uploads: [], error: extractErrorMessage(error).split(" | HTTP ")[0] });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiRequest, folder.patientId, loadKey]);

  const handleDelete = async (upload: PatientUpload) => {
    const confirmed = window.confirm(
      `Delete ${fileNames(upload)}? The AI will no longer find its content for ${folder.name}.`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await apiRequest<null>(`/ai/records/${upload._id}`, { method: "DELETE" });
      setFeedback(`Deleted ${fileNames(upload)}.`);
      setReloadCount((count) => count + 1);
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const startReplace = (upload: PatientUpload) => {
    replaceTargetRef.current = upload;
    replaceInputRef.current?.click();
  };

  const handleReplaceFiles = async (files: File[]) => {
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (!target || files.length === 0) {
      return;
    }

    const newNames = files.map((file) => file.name).join(", ");
    if (!window.confirm(`Replace ${fileNames(target)} with ${newNames}?`)) {
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      await apiRequest<PatientUpload>(`/ai/records/${target._id}/replace`, { method: "POST", body: formData });
      setFeedback(`Replaced ${fileNames(target)} with ${newNames}.`);
      setReloadCount((count) => count + 1);
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const uploads = loaded?.uploads ?? [];

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
          Uploaded files{loaded && !loading ? ` (${uploads.length})` : ""}
        </p>
        <button
          type="button"
          onClick={() => setReloadCount((count) => count + 1)}
          className="text-[11px] text-[#1c4f8c] hover:underline disabled:opacity-50"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {/* One hidden picker shared by every Replace button. */}
      <input
        ref={replaceInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Replacement files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void handleReplaceFiles(files);
        }}
      />

      {loading && !loaded && <p className="text-[11px] text-[#8f8167]">Loading files...</p>}

      {loaded?.error && <p className="text-[11px] text-[#8a1c1c]">{loaded.error}</p>}

      {loaded && !loaded.error && uploads.length === 0 && (
        <p className="text-[11px] text-[#8f8167]">No files uploaded for {folder.name} yet.</p>
      )}

      <ul className="grid gap-1.5">
        {uploads.map((upload) => {
          const canModify = canModifyUpload(currentUser, upload);
          return (
            <li key={upload._id} className="rounded-lg border border-[#e2d8c7] bg-white px-2 py-1.5 text-[11px] text-[#5f523d]">
              {upload.sourceFiles.map((file) => (
                <div key={file.fileName} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="break-all font-semibold text-[#2f2a21]">{file.fileName}</span>
                  <span className="text-[#8f8167]">{formatFileSize(file.sizeBytes)}</span>
                  {file.chunkCount !== undefined ? (
                    <span className="text-[#1a6a3f]">
                      {file.chunkCount} chunk{file.chunkCount === 1 ? "" : "s"} indexed
                    </span>
                  ) : upload.mode === "rag" ? (
                    <span className="text-[#8d6b35]" title="The file was saved but could not be indexed; replace it to retry.">
                      Not indexed for search
                    </span>
                  ) : (
                    <span className="text-[#8f8167]">Summary only</span>
                  )}
                </div>
              ))}
              <div className="mt-0.5 text-[#8f8167]">
                {upload.createdBy?.name ?? "Unknown user"} ({upload.createdByRole}) · {formatDateTime(upload.createdAt)}
              </div>
              {canModify && (
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => startReplace(upload)}
                    className="rounded-md border border-[#d5c8b2] px-2 py-0.5 text-[11px] font-medium text-[#5f523d] hover:bg-[#f9f3e8] disabled:opacity-50"
                    disabled={busy}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(upload)}
                    className="rounded-md border border-[#e6c4c4] px-2 py-0.5 text-[11px] font-medium text-[#8a1c1c] hover:bg-[#fdf2f2] disabled:opacity-50"
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
