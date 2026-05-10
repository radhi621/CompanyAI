"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
      "http://localhost:4000/api/v1")) ||
  "http://localhost:4000/api/v1";

function buildUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Appointment {
  _id: string;
  patientId: { _id: string; name?: string } | string;
  doctorId: { _id: string; name?: string } | string;
  startAt: string;
  endAt: string;
  estimatedDurationMinutes: number;
  reason: string;
  status: string;
  notes?: string;
}

type StatusFilter = "all" | "planned" | "confirmed" | "completed" | "cancelled" | "no_show";

interface CalendarProps {
  token: string | null;
}

export default function Calendar({ token }: CalendarProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [feedback, setFeedback] = useState("");

  const fetchAppointments = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    try {
      const res = await fetch(buildUrl(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to fetch appointments");
      setAppointments(json.data || []);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, viewDate]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const dayAppointments = useMemo(() => {
    if (!selectedDay) return [];
    const ds = selectedDay.toDateString();
    return appointments.filter((a) => new Date(a.startAt).toDateString() === ds);
  }, [appointments, selectedDay]);

  const filteredDayAppointments = useMemo(() => {
    if (statusFilter === "all") return dayAppointments;
    return dayAppointments.filter((a) => a.status === statusFilter);
  }, [dayAppointments, statusFilter]);

  function isToday(day: number) {
    const d = new Date(year, month, day);
    return d.toDateString() === today.toDateString();
  }

  function isSelected(day: number) {
    if (!selectedDay) return false;
    return selectedDay.getDate() === day && selectedDay.getMonth() === month && selectedDay.getFullYear() === year;
  }

  function hasAppointments(day: number) {
    const ds = new Date(year, month, day).toDateString();
    return appointments.some((a) => new Date(a.startAt).toDateString() === ds);
  }

  function getStatusDot(day: number) {
    const ds = new Date(year, month, day).toDateString();
    const dayApps = appointments.filter((a) => new Date(a.startAt).toDateString() === ds);
    const statuses = new Set(dayApps.map((a) => a.status));
    if (statuses.has("cancelled")) return "bg-red-400";
    if (statuses.has("completed") || statuses.has("confirmed")) return "bg-emerald-400";
    if (statuses.has("planned")) return "bg-amber-400";
    return "bg-[#b5a78c]";
  }

  function getPatientName(a: Appointment): string {
    const p = a.patientId;
    if (typeof p === "object" && p !== null) return (p as { name?: string }).name || (p as { _id: string })._id.slice(-6);
    return String(p).slice(-6);
  }

  async function handleCreateAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !selectedDay) return;
    const form = e.currentTarget;
    const data = {
      patientId: (form.elements.namedItem("patientId") as HTMLInputElement).value,
      doctorId: (form.elements.namedItem("doctorId") as HTMLInputElement).value,
      startAt: `${selectedDay.toISOString().slice(0, 10)}T${(form.elements.namedItem("time") as HTMLInputElement).value}:00.000Z`,
      estimatedDurationMinutes: parseInt((form.elements.namedItem("duration") as HTMLInputElement).value, 10),
      reason: (form.elements.namedItem("reason") as HTMLInputElement).value,
      notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value || undefined,
    };
    try {
      const res = await fetch(buildUrl("/appointments"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to create");
      setFeedback("Appointment created");
      setShowCreateForm(false);
      await fetchAppointments();
    } catch (err) {
      setFeedback(extractErrorMessage(err));
    }
  }

  async function handleUpdateAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !editingAppointment) return;
    const form = e.currentTarget;
    const body: Record<string, unknown> = {};
    const timeVal = (form.elements.namedItem("time") as HTMLInputElement).value;
    if (timeVal) {
      body.startAt = `${new Date(editingAppointment.startAt).toISOString().slice(0, 10)}T${timeVal}:00.000Z`;
    }
    const durationVal = (form.elements.namedItem("duration") as HTMLInputElement).value;
    if (durationVal) body.estimatedDurationMinutes = parseInt(durationVal, 10);
    const reasonVal = (form.elements.namedItem("reason") as HTMLInputElement).value;
    if (reasonVal) body.reason = reasonVal;
    const notesVal = (form.elements.namedItem("notes") as HTMLTextAreaElement).value;
    body.notes = notesVal || undefined;
    const statusVal = (form.elements.namedItem("status") as HTMLSelectElement).value;
    if (statusVal) body.status = statusVal;
    try {
      const res = await fetch(buildUrl(`/appointments/${editingAppointment._id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to update");
      setFeedback("Appointment updated");
      setEditingAppointment(null);
      await fetchAppointments();
    } catch (err) {
      setFeedback(extractErrorMessage(err));
    }
  }

  async function handleDeleteAppointment(id: string) {
    if (!token) return;
    try {
      const res = await fetch(buildUrl(`/appointments/${id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to delete");
      setFeedback("Appointment deleted");
      setEditingAppointment(null);
      await fetchAppointments();
    } catch (err) {
      setFeedback(extractErrorMessage(err));
    }
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <div className="text-[11px]">
      {feedback && (
        <p className="mb-2 rounded bg-[#efeadc] px-2 py-1 text-[10px] text-[#6a5b43]">{feedback}</p>
      )}
      {error && (
        <p className="mb-2 rounded bg-[#fce8e6] px-2 py-1 text-[10px] text-[#7f3f3f]">{error}</p>
      )}

      <div className="flex items-center justify-between rounded-lg border border-[#d8ccb6] bg-[#fffaf1] px-2 py-1">
        <button type="button" onClick={prevMonth} className="rounded px-1 py-0.5 text-[#6a5b43] hover:bg-[#efeadc]">
          ◀
        </button>
        <span className="text-xs font-semibold text-[#2f2a21]">
          {monthNames[month]} {year}
        </span>
        <button type="button" onClick={nextMonth} className="rounded px-1 py-0.5 text-[#6a5b43] hover:bg-[#efeadc]">
          ▶
        </button>
      </div>

      <div className="mt-1 grid grid-cols-7 gap-px rounded-lg border border-[#ddd2bf] bg-[#ddd2bf]">
        {dayNames.map((dn) => (
          <div key={dn} className="bg-[#f7f2e8] px-0.5 py-1 text-center text-[9px] font-semibold text-[#8a7c62]">
            {dn}
          </div>
        ))}
        {calendarDays.map((d, i) =>
          d === null ? (
            <div key={`e${i}`} className="bg-[#fbf8f1] px-0.5 py-2" />
          ) : (
            <button
              key={d}
              type="button"
              onClick={() => {
                setSelectedDay(new Date(year, month, d));
                setShowCreateForm(false);
                setEditingAppointment(null);
              }}
              className={`relative bg-[#fffdf7] px-0.5 py-2 text-center text-[10px] transition-colors hover:bg-[#efeadc] ${
                isSelected(d) ? "ring-2 ring-inset ring-[#2f2a21] font-semibold" : ""
              } ${isToday(d) ? "bg-[#e8e0ce]" : ""}`}
            >
              {d}
              {hasAppointments(d) && (
                <span className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${getStatusDot(d)}`} />
              )}
            </button>
          ),
        )}
      </div>

      {loading && <p className="mt-1 text-[10px] text-[#8a7c62]">Loading...</p>}

      {selectedDay && !editingAppointment && !showCreateForm && (
        <div className="mt-2 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-[#2f2a21]">
              {selectedDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </p>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="rounded bg-[#2f2a21] px-2 py-0.5 text-[9px] font-medium text-[#f8f4ec]"
            >
              + Add
            </button>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="mt-1 w-full rounded border border-[#d7ccb8] bg-white px-1 py-0.5 text-[10px] text-[#2f2a21]"
          >
            <option value="all">All statuses</option>
            <option value="planned">Planned</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>

          <div className="mt-1 max-h-[160px] space-y-1 overflow-y-auto">
            {filteredDayAppointments.length === 0 && (
              <p className="py-2 text-center text-[10px] text-[#8a7c62]">No appointments</p>
            )}
            {filteredDayAppointments.map((a) => (
              <button
                key={a._id}
                type="button"
                onClick={() => {
                  setEditingAppointment(a);
                  setShowCreateForm(false);
                }}
                className="w-full rounded border border-[#ddd2bf] bg-white px-2 py-1 text-left transition-colors hover:bg-[#efeadc]"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium text-[#2f2a21]">
                    {formatTime(a.startAt)}–{formatTime(a.endAt)}
                  </span>
                  <span className={`rounded px-1 text-[8px] font-medium ${
                    a.status === "cancelled" ? "bg-red-100 text-red-700" :
                    a.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                    a.status === "confirmed" ? "bg-blue-100 text-blue-700" :
                    a.status === "no_show" ? "bg-orange-100 text-orange-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>
                    {a.status}
                  </span>
                </div>
                <p className="truncate text-[9px] text-[#655842]">{a.reason}</p>
                <p className="text-[9px] text-[#8a7c62]">{getPatientName(a)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCreateForm && selectedDay && (
        <form onSubmit={handleCreateAppointment} className="mt-2 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <p className="mb-1 text-[10px] font-semibold text-[#2f2a21]">
            New Appointment — {selectedDay.toLocaleDateString()}
          </p>
          <div className="grid gap-1.5">
            <input name="patientId" placeholder="Patient ID (ObjectId)" required className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
            <input name="doctorId" placeholder="Doctor ID (ObjectId)" required className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
            <div className="flex gap-1">
              <input name="time" type="time" defaultValue="09:00" required className="w-24 rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
              <input name="duration" type="number" placeholder="Duration (min)" defaultValue={30} min={5} max={720} required className="flex-1 rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
            </div>
            <input name="reason" placeholder="Reason" required className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
            <textarea name="notes" placeholder="Notes (optional)" rows={2} className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]" />
            <div className="flex gap-1">
              <button type="submit" className="flex-1 rounded bg-[#2f2a21] py-1 text-[10px] font-medium text-[#f8f4ec]">Create</button>
              <button type="button" onClick={() => setShowCreateForm(false)} className="rounded border border-[#d7ccb8] px-3 py-1 text-[10px] text-[#6a5b43]">Cancel</button>
            </div>
          </div>
        </form>
      )}

      {editingAppointment && (
        <div className="mt-2 rounded-lg border border-[#d8ccb6] bg-[#fffaf1] p-2">
          <p className="mb-1 text-[10px] font-semibold text-[#2f2a21]">
            Edit Appointment — {new Date(editingAppointment.startAt).toLocaleDateString()}
          </p>
          <form onSubmit={handleUpdateAppointment} className="grid gap-1.5">
            <div className="flex gap-1">
              <input
                name="time"
                type="time"
                defaultValue={new Date(editingAppointment.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                className="w-24 rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]"
              />
              <input
                name="duration"
                type="number"
                defaultValue={editingAppointment.estimatedDurationMinutes}
                min={5} max={720}
                className="flex-1 rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]"
              />
              <select
                name="status"
                defaultValue={editingAppointment.status}
                className="flex-1 rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]"
              >
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no_show">No Show</option>
              </select>
            </div>
            <input
              name="reason"
              defaultValue={editingAppointment.reason}
              placeholder="Reason"
              className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]"
            />
            <textarea
              name="notes"
              defaultValue={editingAppointment.notes || ""}
              placeholder="Notes"
              rows={2}
              className="rounded border border-[#d7ccb8] bg-white px-2 py-1 text-[10px]"
            />
            <div className="flex gap-1">
              <button type="submit" className="flex-1 rounded bg-[#2f2a21] py-1 text-[10px] font-medium text-[#f8f4ec]">Update</button>
              <button
                type="button"
                onClick={() => handleDeleteAppointment(editingAppointment._id)}
                className="rounded bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700"
              >
                Delete
              </button>
              <button type="button" onClick={() => setEditingAppointment(null)} className="rounded border border-[#d7ccb8] px-2 py-1 text-[10px] text-[#6a5b43]">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
