import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Calendar from "../components/Calendar";

const API = "http://api.test/api/v1";

// Appointments on the 15th of the current month, so they show in the month that opens.
const now = new Date();
const DAY = 15;
const at = (hours: number, minutes = 0) => new Date(now.getFullYear(), now.getMonth(), DAY, hours, minutes).toISOString();

const APPOINTMENTS = [
  {
    _id: "a1",
    patientId: { _id: "p1", firstName: "Leila", lastName: "Mansouri" },
    doctorId: { _id: "d1", name: "Dr Amrani" },
    startAt: at(9),
    endAt: at(9, 45),
    estimatedDurationMinutes: 45,
    reason: "Migraine follow-up",
    status: "planned",
  },
  {
    _id: "a2",
    patientId: "6ac7f8e295fc5deac8262ef0",
    doctorId: "d1",
    startAt: at(11),
    endAt: at(11, 30),
    estimatedDurationMinutes: 30,
    reason: "Blood test review",
    status: "completed",
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stubs fetch: GET /appointments returns the list; mutations succeed and are recorded. */
function stubFetch(handler?: (url: string, init: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const custom = handler?.(url, init);
    if (custom) return custom;
    if ((init.method ?? "GET") === "GET") return json({ data: APPOINTMENTS });
    return json({ data: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const mutations = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");

async function openDay() {
  fireEvent.click(await screen.findByRole("button", { name: String(DAY) }));
}

describe("Calendar", () => {
  it("loads the month with the access token and lists a day's appointments", async () => {
    const fetchMock = stubFetch();
    render(<Calendar token="access-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    const requested = new URL(url);
    expect(`${requested.origin}${requested.pathname}`).toBe(`${API}/appointments`);
    expect(new Date(requested.searchParams.get("from")!).getDate()).toBe(1);
    expect(new Date(requested.searchParams.get("to")!).getMonth()).toBe(now.getMonth());
    expect(requested.searchParams.get("limit")).toBe("200");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-1");

    await openDay();
    expect(await screen.findByText("Migraine follow-up")).toBeTruthy();
    expect(screen.getByText("Leila Mansouri")).toBeTruthy();
    // A patient that is only an ID shows its last six characters.
    expect(screen.getByText("262ef0")).toBeTruthy();
  });

  it("filters a day's appointments by status", async () => {
    stubFetch();
    render(<Calendar token="access-1" />);
    await openDay();
    await screen.findByText("Migraine follow-up");

    fireEvent.change(screen.getByDisplayValue("All statuses"), { target: { value: "completed" } });

    expect(screen.queryByText("Migraine follow-up")).toBeNull();
    expect(screen.getByText("Blood test review")).toBeTruthy();
  });

  it("retries once with a refreshed token after a 401", async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => (calls++ === 0 ? json({ message: "Token expired" }, 401) : undefined));
    const refreshAccessToken = vi.fn(async () => "access-2");
    render(<Calendar token="access-1" refreshAccessToken={refreshAccessToken} />);

    await openDay();
    expect(await screen.findByText("Migraine follow-up")).toBeTruthy();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer access-2");
  });

  it("shows the API's error message", async () => {
    stubFetch(() => json({ message: "Database unavailable" }, 500));
    render(<Calendar token="access-1" />);

    expect(await screen.findByText("Database unavailable")).toBeTruthy();
  });

  it("creates an appointment at the picked local time", async () => {
    const fetchMock = stubFetch();
    render(<Calendar token="access-1" />);
    await openDay();
    fireEvent.click(await screen.findByRole("button", { name: "+ Add" }));

    // The admin-only override is hidden for other roles.
    expect(screen.queryByText(/Allow outside the doctor/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Patient ID (ObjectId)"), { target: { value: "p1" } });
    fireEvent.change(screen.getByPlaceholderText("Doctor ID (ObjectId)"), { target: { value: "d1" } });
    fireEvent.change(screen.getByPlaceholderText("Reason"), { target: { value: "Check-up" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Appointment created")).toBeTruthy();
    const [[url, init]] = mutations(fetchMock);
    expect(url).toBe(`${API}/appointments`);
    expect(JSON.parse(String(init?.body))).toEqual({
      patientId: "p1",
      doctorId: "d1",
      startAt: at(9),
      estimatedDurationMinutes: 30,
      reason: "Check-up",
    });
  });

  it("sends only the status when that is all that changed, so it is not a reschedule", async () => {
    const fetchMock = stubFetch();
    render(<Calendar token="access-1" isAdmin />);
    await openDay();
    fireEvent.click(await screen.findByText("Migraine follow-up"));

    expect(screen.getByText(/Allow outside the doctor/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Planned"), { target: { value: "confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("Appointment updated")).toBeTruthy();
    const [[url, init]] = mutations(fetchMock);
    expect(url).toBe(`${API}/appointments/a1`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "confirmed" });
  });

  it("deletes the appointment being edited", async () => {
    const fetchMock = stubFetch();
    render(<Calendar token="access-1" />);
    await openDay();
    fireEvent.click(await screen.findByText("Migraine follow-up"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Appointment deleted")).toBeTruthy();
    expect(mutations(fetchMock)[0][0]).toBe(`${API}/appointments/a1`);
    expect(mutations(fetchMock)[0][1]?.method).toBe("DELETE");
  });
});
