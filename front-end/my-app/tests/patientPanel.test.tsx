import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PatientPanel, { type ApiRequest } from "../components/PatientPanel";

const PATIENT = {
  _id: "6ac7f8e295fc5deac8262ee7",
  firstName: "Leila",
  lastName: "Mansouri",
  cin: "DEMO1005",
  phone: "0612340005",
  dateOfBirth: "2001-09-09T00:00:00.000Z",
  pathologies: ["Migraine"],
};
const OTHER = { ...PATIENT, _id: "6ac7f8e295fc5deac8262ee8", firstName: "Omar", lastName: "Idrissi", cin: "DEMO1006" };

const NURSE = { id: "nurse-1", role: "nurse" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };

function note(id: string, authorId: string, content: string) {
  return {
    _id: id,
    content,
    createdBy: { _id: authorId, name: authorId === NURSE.id ? "Nadia Bennani" : "Dr Amrani" },
    createdByRole: authorId === NURSE.id ? "nurse" : "doctor",
    createdAt: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
  };
}

/** Fake request helper: answers the panel's GETs from `notes`, records every mutation. */
function fakeRequest(notes = [note("n1", NURSE.id, "Reports 3-4 migraine episodes per month.")]) {
  let currentNotes = [...notes];
  const request = vi.fn(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (method === "GET" && path.startsWith("/patients?")) return [PATIENT, OTHER];
    if (method === "GET" && path.endsWith("/notes?limit=100")) return currentNotes;
    if (method === "GET" && path === `/patients/${PATIENT._id}`) return PATIENT;
    if (method === "PATCH" && path === `/patients/${PATIENT._id}`) {
      return { ...PATIENT, ...JSON.parse(String(options?.body)), pathologies: ["Asthma"] };
    }
    if (method === "POST" && path.endsWith("/notes")) {
      const created = note("n2", NURSE.id, JSON.parse(String(options?.body)).content);
      currentNotes = [created, ...currentNotes];
      return created;
    }
    if (method === "DELETE") return null;
    throw new Error(`unexpected ${method} ${path}`);
  });
  return request;
}

function renderPanel(request: ReturnType<typeof fakeRequest>, currentUser: { id: string; role: "admin" | "nurse" } = NURSE) {
  render(
    <PatientPanel
      request={request as unknown as ApiRequest}
      currentUser={currentUser}
      preferredPatientId={PATIENT._id}
    />,
  );
}

const mutations = (request: ReturnType<typeof fakeRequest>) =>
  request.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");

describe("PatientPanel", () => {
  it("opens the preferred patient with details and notes", async () => {
    renderPanel(fakeRequest());

    expect(await screen.findByText("CIN DEMO1005")).toBeTruthy();
    expect(screen.getByText("2001-09-09")).toBeTruthy();
    expect(screen.getByText("Migraine")).toBeTruthy();
    expect(screen.getByText("Notes (1)")).toBeTruthy();
    expect(screen.getByText("Reports 3-4 migraine episodes per month.")).toBeTruthy();
  });

  it("filters the patient list by name or CIN", async () => {
    renderPanel(fakeRequest());
    await screen.findByText("CIN DEMO1005");

    fireEvent.change(screen.getByPlaceholderText("Filter by name or CIN"), { target: { value: "DEMO1006" } });

    const options = within(screen.getByRole("combobox")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("Omar Idrissi (DEMO1006)");
    // The open patient stays selectable even when the filter hides it.
    expect(options).toContain("Leila Mansouri (DEMO1005)");
    expect(options).toHaveLength(3);
  });

  it("does not let a nurse edit patient details", async () => {
    renderPanel(fakeRequest());
    await screen.findByText("CIN DEMO1005");

    // The only Edit button is on the nurse's own note, not on the patient card.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getByText("Reports 3-4 migraine episodes per month.")).toBeTruthy();
  });

  it("sends only changed fields, with pathologies as additions and removals", async () => {
    const request = fakeRequest([]);
    renderPanel(request, ADMIN);
    await screen.findByText("CIN DEMO1005");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Phone"), { target: { value: "0699999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Migraine" }));
    fireEvent.change(screen.getByPlaceholderText("Add pathology"), { target: { value: "Asthma" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Patient updated")).toBeTruthy();
    const [[path, options]] = mutations(request);
    expect(path).toBe(`/patients/${PATIENT._id}`);
    expect(JSON.parse(String(options?.body))).toEqual({
      phone: "0699999999",
      pathologies: ["Asthma"],
      removePathologies: ["Migraine"],
    });
  });

  it("does not send a request when nothing changed", async () => {
    const request = fakeRequest([]);
    renderPanel(request, ADMIN);
    await screen.findByText("CIN DEMO1005");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByPlaceholderText("Phone")).toBeNull());
    expect(mutations(request)).toHaveLength(0);
  });

  it("adds a note and reloads the list", async () => {
    const request = fakeRequest();
    renderPanel(request);
    await screen.findByText("Notes (1)");

    fireEvent.change(screen.getByPlaceholderText("Add a note…"), { target: { value: "  Headache diary started.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText("Notes (2)")).toBeTruthy();
    expect(JSON.parse(String(mutations(request)[0][1]?.body))).toEqual({ content: "Headache diary started." });
  });

  it("only offers edit and delete on the user's own notes, and deletes after a confirmation", async () => {
    const request = fakeRequest([
      note("n1", NURSE.id, "Own note."),
      note("n2", "doctor-1", "Doctor's note."),
    ]);
    renderPanel(request);
    await screen.findByText("Notes (2)");

    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mutations(request)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByText("Note deleted")).toBeTruthy();
    expect(mutations(request)[0][0]).toBe(`/patients/${PATIENT._id}/notes/n1`);
    expect(screen.queryByText("Own note.")).toBeNull();
    expect(screen.getByText("Doctor's note.")).toBeTruthy();
  });

  it("shows the readable part of an error", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.startsWith("/patients?")) return [];
      throw new Error("You are not assigned to this patient | HTTP 403 GET /patients/x");
    });
    renderPanel(request as unknown as ReturnType<typeof fakeRequest>);

    expect(await screen.findByText("You are not assigned to this patient")).toBeTruthy();
  });
});
