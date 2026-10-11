"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type UserRole = "admin" | "doctor" | "nurse" | "secretary";

/** The page's authenticated request helper (handles tokens, refresh and error messages). */
export type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

interface Patient {
  _id: string;
  firstName: string;
  lastName: string;
  cin: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  pathologies: string[];
}

interface PatientNote {
  _id: string;
  content: string;
  createdBy: { _id: string; name?: string; role?: UserRole } | string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
}

interface PatientPanelProps {
  request: ApiRequest;
  currentUser: { id: string; role: UserRole };
  /** Patient to open by default, e.g. the active patient chat folder. */
  preferredPatientId?: string | null;
}

interface EditForm {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  pathologies: string[];
}

const inputClass = "rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]";

// apiRequest appends "| HTTP <status> <method> <url>" for debugging; keep the readable part.
function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(" | HTTP ")[0];
}

function toEditForm(patient: Patient): EditForm {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    phone: patient.phone ?? "",
    email: patient.email ?? "",
    dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.slice(0, 10) : "",
    pathologies: [...patient.pathologies],
  };
}

function noteAuthor(note: PatientNote): { id: string; name: string } {
  if (typeof note.createdBy === "object" && note.createdBy !== null) {
    return { id: note.createdBy._id, name: note.createdBy.name ?? "Unknown" };
  }
  return { id: String(note.createdBy), name: "Unknown" };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export default function PatientPanel({ request, currentUser, preferredPatientId }: PatientPanelProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [newPathology, setNewPathology] = useState("");
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  // Mirrors the backend: admins and (assigned) secretaries edit patient details.
  const canEditPatient = currentUser.role === "admin" || currentUser.role === "secretary";
  const activePatientId = selectedId || preferredPatientId || "";

  const loadPatients = useCallback(async () => {
    try {
      setPatients(await request<Patient[]>("/patients?limit=100"));
    } catch (err) {
      setError(readableError(err));
    }
  }, [request]);

  const loadPatient = useCallback(
    async (patientId: string) => {
      setError("");
      try {
        const [loadedPatient, loadedNotes] = await Promise.all([
          request<Patient>(`/patients/${patientId}`),
          request<PatientNote[]>(`/patients/${patientId}/notes?limit=100`),
        ]);
        setPatient(loadedPatient);
        setNotes(loadedNotes);
      } catch (err) {
        setPatient(null);
        setNotes([]);
        setError(readableError(err));
      }
    },
    [request],
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadPatients();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadPatients]);

  useEffect(() => {
    if (!activePatientId) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setEditForm(null);
      setEditingNoteId(null);
      setPendingDeleteNoteId(null);
      setFeedback("");
      void loadPatient(activePatientId);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [activePatientId, loadPatient]);

  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((p) =>
      `${p.firstName} ${p.lastName} ${p.cin}`.toLowerCase().includes(term),
    );
  }, [patients, search]);

  async function run(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
      setFeedback(successMessage);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient || !editForm) return;

    // Send only what changed; pathologies are expressed as additions and removals.
    const body: Record<string, unknown> = {};
    if (editForm.firstName.trim() !== patient.firstName) body.firstName = editForm.firstName.trim();
    if (editForm.lastName.trim() !== patient.lastName) body.lastName = editForm.lastName.trim();
    if (editForm.phone.trim() && editForm.phone.trim() !== (patient.phone ?? "")) body.phone = editForm.phone.trim();
    if (editForm.email.trim() && editForm.email.trim() !== (patient.email ?? "")) body.email = editForm.email.trim();
    if (editForm.dateOfBirth && editForm.dateOfBirth !== (patient.dateOfBirth ?? "").slice(0, 10)) {
      body.dateOfBirth = editForm.dateOfBirth;
    }

    const before = new Set(patient.pathologies.map((p) => p.toLowerCase()));
    const after = new Set(editForm.pathologies.map((p) => p.toLowerCase()));
    const added = editForm.pathologies.filter((p) => !before.has(p.toLowerCase()));
    const removed = patient.pathologies.filter((p) => !after.has(p.toLowerCase()));
    if (added.length > 0) body.pathologies = added;
    if (removed.length > 0) body.removePathologies = removed;

    if (Object.keys(body).length === 0) {
      setEditForm(null);
      return;
    }

    await run(async () => {
      const updated = await request<Patient>(`/patients/${patient._id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setPatient(updated);
      setPatients((current) => current.map((p) => (p._id === updated._id ? updated : p)));
      setEditForm(null);
    }, "Patient updated");
  }

  function addPathology() {
    const value = newPathology.trim();
    if (!editForm || value.length < 2) return;
    if (!editForm.pathologies.some((p) => p.toLowerCase() === value.toLowerCase())) {
      setEditForm({ ...editForm, pathologies: [...editForm.pathologies, value] });
    }
    setNewPathology("");
  }

  async function handleAddNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient || newNote.trim().length < 3) return;

    await run(async () => {
      await request<PatientNote>(`/patients/${patient._id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: newNote.trim() }),
      });
      setNewNote("");
      setNotes(await request<PatientNote[]>(`/patients/${patient._id}/notes?limit=100`));
    }, "Note added");
  }

  async function handleSaveNote(noteId: string) {
    if (!patient || editingNoteContent.trim().length < 3) return;

    await run(async () => {
      const updated = await request<PatientNote>(`/patients/${patient._id}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editingNoteContent.trim() }),
      });
      setNotes((current) => current.map((n) => (n._id === noteId ? { ...n, content: updated.content, updatedAt: updated.updatedAt } : n)));
      setEditingNoteId(null);
    }, "Note updated");
  }

  async function handleDeleteNote(noteId: string) {
    if (!patient) return;

    await run(async () => {
      await request<null>(`/patients/${patient._id}/notes/${noteId}`, { method: "DELETE" });
      setNotes((current) => current.filter((n) => n._id !== noteId));
      setPendingDeleteNoteId(null);
    }, "Note deleted");
  }

  return (
    <div className="text-[11px]">
      <div className="grid gap-1">
        <input
          className={inputClass}
          placeholder="Filter by name or CIN"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={inputClass}
          value={activePatientId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">Select a patient…</option>
          {patient && !filteredPatients.some((p) => p._id === patient._id) && (
            <option value={patient._id}>
              {patient.firstName} {patient.lastName} ({patient.cin})
            </option>
          )}
          {filteredPatients.map((p) => (
            <option key={p._id} value={p._id}>
              {p.firstName} {p.lastName} ({p.cin})
            </option>
          ))}
        </select>
      </div>

      {feedback && <p className="mt-2 rounded bg-[#efeadc] px-2 py-1 text-[10px] text-[#6a5b43]">{feedback}</p>}
      {error && <p className="mt-2 rounded bg-[#fce8e6] px-2 py-1 text-[10px] text-[#7f3f3f]">{error}</p>}

      {patient && !editForm && (
        <div className="mt-2 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#2f2a21]">
                {patient.firstName} {patient.lastName}
              </p>
              <p className="text-[10px] text-[#8a7c62]">CIN {patient.cin}</p>
            </div>
            {canEditPatient && (
              <button
                type="button"
                onClick={() => setEditForm(toEditForm(patient))}
                className="shrink-0 rounded border border-[#d2c6b1] px-2 py-0.5 text-[10px] text-[#6a5b43] hover:bg-[#fff8ed]"
              >
                Edit
              </button>
            )}
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
            <dt className="text-[#8a7c62]">Born</dt>
            <dd className="text-[#2f2a21]">{patient.dateOfBirth ? patient.dateOfBirth.slice(0, 10) : "—"}</dd>
            <dt className="text-[#8a7c62]">Phone</dt>
            <dd className="truncate text-[#2f2a21]">{patient.phone || "—"}</dd>
            <dt className="text-[#8a7c62]">Email</dt>
            <dd className="truncate text-[#2f2a21]">{patient.email || "—"}</dd>
          </dl>
          <div className="mt-1 flex flex-wrap gap-1">
            {patient.pathologies.length === 0 && <span className="text-[10px] text-[#8a7c62]">No pathologies recorded</span>}
            {patient.pathologies.map((p) => (
              <span key={p} className="rounded-full bg-[#efe6d6] px-2 py-0.5 text-[9px] text-[#5d5040]">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {patient && editForm && (
        <form onSubmit={(event) => void handleSavePatient(event)} className="mt-2 grid gap-1.5 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <p className="text-[10px] font-semibold text-[#2f2a21]">Edit patient — CIN {patient.cin}</p>
          <div className="flex gap-1">
            <input
              className={`${inputClass} min-w-0 flex-1`}
              placeholder="First name"
              value={editForm.firstName}
              onChange={(event) => setEditForm({ ...editForm, firstName: event.target.value })}
              minLength={2}
              required
            />
            <input
              className={`${inputClass} min-w-0 flex-1`}
              placeholder="Last name"
              value={editForm.lastName}
              onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })}
              minLength={2}
              required
            />
          </div>
          <input
            className={inputClass}
            placeholder="Phone"
            value={editForm.phone}
            onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
          />
          <input
            type="email"
            className={inputClass}
            placeholder="Email"
            value={editForm.email}
            onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
          />
          <label className="grid gap-0.5 text-[10px] text-[#6a5b43]">
            Date of birth
            <input
              type="date"
              className={inputClass}
              value={editForm.dateOfBirth}
              onChange={(event) => setEditForm({ ...editForm, dateOfBirth: event.target.value })}
            />
          </label>
          <div>
            <p className="text-[10px] text-[#6a5b43]">Pathologies</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {editForm.pathologies.map((p) => (
                <span key={p} className="flex items-center gap-1 rounded-full bg-[#efe6d6] px-2 py-0.5 text-[9px] text-[#5d5040]">
                  {p}
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, pathologies: editForm.pathologies.filter((item) => item !== p) })}
                    className="text-[#7f3f3f]"
                    aria-label={`Remove ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              <input
                className={`${inputClass} min-w-0 flex-1`}
                placeholder="Add pathology"
                value={newPathology}
                onChange={(event) => setNewPathology(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPathology();
                  }
                }}
              />
              <button
                type="button"
                onClick={addPathology}
                className="rounded border border-[#d2c6b1] px-2 text-[10px] text-[#6a5b43] hover:bg-[#fff8ed]"
              >
                Add
              </button>
            </div>
          </div>
          <div className="flex gap-1">
            <button type="submit" disabled={busy} className="flex-1 rounded bg-[#2f2a21] py-1 text-[10px] font-medium text-[#f8f4ec]">
              {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditForm(null)}
              className="rounded border border-[#d7ccb8] px-3 py-1 text-[10px] text-[#6a5b43]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {patient && (
        <div className="mt-2 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <p className="text-[10px] font-semibold text-[#2f2a21]">Notes ({notes.length})</p>

          <form onSubmit={(event) => void handleAddNote(event)} className="mt-1 grid gap-1">
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Add a note…"
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              maxLength={4000}
            />
            <button
              type="submit"
              disabled={busy || newNote.trim().length < 3}
              className="rounded bg-[#2f2a21] py-1 text-[10px] font-medium text-[#f8f4ec] disabled:opacity-50"
            >
              Add note
            </button>
          </form>

          <div className="mt-2 max-h-[260px] space-y-1 overflow-y-auto pr-1">
            {notes.length === 0 && <p className="py-2 text-center text-[10px] text-[#8a7c62]">No notes yet</p>}
            {notes.map((note) => {
              const author = noteAuthor(note);
              const canModify = currentUser.role === "admin" || author.id === currentUser.id;
              const isEditing = editingNoteId === note._id;

              return (
                <div key={note._id} className="rounded border border-[#ddd2bf] bg-white px-2 py-1">
                  <div className="flex items-center justify-between gap-1 text-[9px] text-[#8a7c62]">
                    <span className="truncate">
                      {author.name} · {note.createdByRole} · {formatDateTime(note.createdAt)}
                      {note.updatedAt !== note.createdAt ? " (edited)" : ""}
                    </span>
                    {canModify && !isEditing && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteId(note._id);
                            setEditingNoteContent(note.content);
                            setPendingDeleteNoteId(null);
                          }}
                          className="text-[#6a5b43] hover:underline"
                        >
                          Edit
                        </button>
                        {pendingDeleteNoteId === note._id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleDeleteNote(note._id)}
                              className="font-semibold text-[#7f3f3f] hover:underline"
                              disabled={busy}
                            >
                              Confirm delete
                            </button>
                            <button type="button" onClick={() => setPendingDeleteNoteId(null)} className="text-[#6a5b43] hover:underline">
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteNoteId(note._id)}
                            className="text-[#7f3f3f] hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-1 grid gap-1">
                      <textarea
                        className={inputClass}
                        rows={3}
                        value={editingNoteContent}
                        onChange={(event) => setEditingNoteContent(event.target.value)}
                        maxLength={4000}
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handleSaveNote(note._id)}
                          disabled={busy || editingNoteContent.trim().length < 3}
                          className="flex-1 rounded bg-[#2f2a21] py-0.5 text-[10px] text-[#f8f4ec] disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNoteId(null)}
                          className="rounded border border-[#d7ccb8] px-2 py-0.5 text-[10px] text-[#6a5b43]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] text-[#2f2a21]">{note.content}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
