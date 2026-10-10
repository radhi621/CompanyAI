import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PatientUploads from "../components/PatientUploads";
import type { ApiRequest, AuthUser, PatientFolder, PatientUpload } from "../lib/types";
import { canModifyUpload, formatFileSize } from "../lib/utils";

const DOCTOR: AuthUser = { id: "doctor-1", name: "Dr Amrani", email: "amrani@example.com", role: "doctor" };
const NURSE: AuthUser = { id: "nurse-1", name: "Nadia", email: "nadia@example.com", role: "nurse" };
const FOLDER: PatientFolder = { id: "folder-1", name: "Leila Mansouri", patientId: "6ac7f8e295fc5deac8262ee7", createdAt: 0 };

function makeUpload(overrides: Partial<PatientUpload> = {}): PatientUpload {
  return {
    _id: "upload-1",
    patientId: FOLDER.patientId,
    mode: "rag",
    sourceFiles: [{ fileName: "record.txt", extension: ".txt", mimeType: "text/plain", sizeBytes: 6499, chunkCount: 5 }],
    createdBy: { _id: DOCTOR.id, name: DOCTOR.name, role: "doctor" },
    createdByRole: "doctor",
    createdAt: "2026-10-09T12:13:37.149Z",
    ...overrides,
  };
}

/** A fake apiRequest: the list returns `lists` in turn; DELETE and replace succeed. */
function fakeApi(lists: PatientUpload[][]) {
  let listCall = 0;
  const apiRequest = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.startsWith("/ai/records?")) {
      const list = lists[Math.min(listCall, lists.length - 1)];
      listCall += 1;
      return list;
    }
    if (options?.method === "DELETE") return null;
    if (path.endsWith("/replace")) return makeUpload({ _id: "upload-2" });
    throw new Error(`unexpected ${path}`);
  });
  return apiRequest;
}

function renderUploads(apiRequest: ReturnType<typeof fakeApi>, currentUser: AuthUser = DOCTOR) {
  const setFeedback = vi.fn();
  render(
    <PatientUploads
      apiRequest={apiRequest as unknown as ApiRequest}
      currentUser={currentUser}
      folder={FOLDER}
      refreshKey={0}
      busy={false}
      setBusy={vi.fn()}
      setFeedback={setFeedback}
    />,
  );
  return { setFeedback };
}

describe("PatientUploads", () => {
  it("lists the patient's files with size, indexing status and uploader", async () => {
    const apiRequest = fakeApi([
      [
        makeUpload(),
        makeUpload({
          _id: "upload-2",
          sourceFiles: [{ fileName: "scan.pdf", extension: ".pdf", mimeType: "application/pdf", sizeBytes: 2048 }],
        }),
      ],
    ]);
    renderUploads(apiRequest);

    expect(await screen.findByText("record.txt")).toBeTruthy();
    expect(screen.getByText("6.3 KB")).toBeTruthy();
    expect(screen.getByText("5 chunks indexed")).toBeTruthy();
    expect(screen.getByText("Not indexed for search")).toBeTruthy();
    expect(screen.getAllByText(/Dr Amrani \(doctor\)/)).toHaveLength(2);
    expect(screen.getByText("Uploaded files (2)")).toBeTruthy();
    expect(apiRequest.mock.calls[0][0]).toBe(`/ai/records?patientId=${FOLDER.patientId}&hasFiles=true&limit=50`);
  });

  it("says when there are no files", async () => {
    renderUploads(fakeApi([[]]));

    expect(await screen.findByText("No files uploaded for Leila Mansouri yet.")).toBeTruthy();
  });

  it("hides delete and replace from a lower role who did not upload the file", async () => {
    renderUploads(fakeApi([[makeUpload()]]), NURSE);

    await screen.findByText("record.txt");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("deletes after confirmation and reloads the list", async () => {
    const apiRequest = fakeApi([[makeUpload()], []]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { setFeedback } = renderUploads(apiRequest);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText("No files uploaded for Leila Mansouri yet.")).toBeTruthy());
    expect(apiRequest).toHaveBeenCalledWith("/ai/records/upload-1", { method: "DELETE" });
    expect(setFeedback).toHaveBeenLastCalledWith("Deleted record.txt.");
  });

  it("does nothing when deletion is cancelled", async () => {
    const apiRequest = fakeApi([[makeUpload()]]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderUploads(apiRequest);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(apiRequest).toHaveBeenCalledTimes(1); // only the initial list
  });

  it("replaces a file with the one picked", async () => {
    const replaced = makeUpload({
      _id: "upload-2",
      sourceFiles: [{ fileName: "record-v2.txt", extension: ".txt", mimeType: "text/plain", sizeBytes: 100, chunkCount: 1 }],
    });
    const apiRequest = fakeApi([[makeUpload()], [replaced]]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderUploads(apiRequest);

    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const file = new File(["new content"], "record-v2.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Replacement files"), { target: { files: [file] } });

    expect(await screen.findByText("record-v2.txt")).toBeTruthy();
    expect(confirm).toHaveBeenCalledWith("Replace record.txt with record-v2.txt?");
    const [path, options] = apiRequest.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/ai/records/upload-1/replace");
    expect(options.method).toBe("POST");
    expect((options.body as FormData).getAll("files")).toHaveLength(1);
  });

  it("shows why the list could not load", async () => {
    const apiRequest = vi.fn(async () => {
      throw new Error("You are not assigned to this patient | HTTP 403 GET /ai/records");
    });
    renderUploads(apiRequest as unknown as ReturnType<typeof fakeApi>);

    expect(await screen.findByText("You are not assigned to this patient")).toBeTruthy();
  });
});

describe("canModifyUpload", () => {
  const upload = { createdBy: { _id: DOCTOR.id }, createdByRole: "doctor" as const };

  it("allows the uploader and higher roles only", () => {
    expect(canModifyUpload(DOCTOR, upload)).toBe(true);
    expect(canModifyUpload({ id: "admin-1", role: "admin" }, upload)).toBe(true);
    expect(canModifyUpload({ id: "doctor-2", role: "doctor" }, upload)).toBe(false);
    expect(canModifyUpload(NURSE, upload)).toBe(false);
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(6499)).toBe("6.3 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
