import { DateTime } from "luxon";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AIRecordModel } from "../src/models/AIRecord";
import { AGENT_TOOL_NAMES, AgentPendingActionModel } from "../src/models/AgentPendingAction";
import { AppointmentModel } from "../src/models/Appointment";
import { executeToolCall, getToolCatalogForPrompt } from "../src/modules/agent/agent.tools";
import { appointmentsService } from "../src/modules/appointments/appointments.service";
import { llmRouter } from "../src/services/llm/llmRouter";
import { ragService } from "../src/services/rag/ragService";
import { API, type TestSession, api, auth, createDoctor, createPatient, createSession } from "./helpers";

let admin: TestSession;
let secretary: TestSession;
let nurse: TestSession;
let doctorId: string;

const tomorrowAt = (hour: number) =>
  DateTime.now().setZone("Africa/Casablanca").plus({ days: 1 }).set({ hour, minute: 0, second: 0, millisecond: 0 });

/** Makes the planner return `plan`; any other LLM call (e.g. the summary) returns plain text. */
function stubPlanner(plan: unknown) {
  return vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => ({
    provider: "gemini",
    text: prompt.startsWith("You are an orchestration planner") ? JSON.stringify(plan) : "Summary.",
  }));
}

beforeAll(async () => {
  admin = await createSession("admin");
  secretary = await createSession("secretary");
  nurse = await createSession("nurse");
  doctorId = (await createDoctor(admin.id))._id.toString();
});

describe("tool access", () => {
  it("does not offer a staff-account tool to the planner", () => {
    expect(AGENT_TOOL_NAMES).not.toContain("create_staff_account");
    expect(getToolCatalogForPrompt().map((tool) => tool.name)).not.toContain("create_staff_account");
  });

  it("limits the global-search fallback to the caller's assigned patients", async () => {
    vi.spyOn(ragService, "retrieveGlobalContext").mockResolvedValue([]);
    const mine = await createPatient({ createdBy: admin.id, assignedStaff: [nurse.id] });
    const other = await createPatient({ createdBy: admin.id });
    for (const [patient, text] of [[mine, "penicillin allergy (assigned)"], [other, "penicillin allergy (other)"]] as const) {
      await AIRecordModel.create({
        patientId: patient._id, prompt: "p", response: text, mode: "non_rag", provider: "gemini",
        createdBy: new Types.ObjectId(admin.id), createdByRole: "admin",
      });
    }

    const call = { tool: "search_global_knowledge_RAG" as const, args: { query: "penicillin allergy" } };
    const asNurse = (await executeToolCall(call, { actor: nurse.actor })) as { matches: Array<{ content: string }> };
    const asAdmin = (await executeToolCall(call, { actor: admin.actor })) as { matches: Array<{ content: string }> };

    expect(asNurse.matches.map((m) => m.content)).toEqual(["penicillin allergy (assigned)"]);
    expect(asAdmin.matches).toHaveLength(2);
  });

  it("enforces patient assignment in update_patient", async () => {
    const unassigned = await createPatient({ createdBy: admin.id });
    await expect(
      executeToolCall({ tool: "update_patient", args: { patientId: unassigned._id.toString(), phone: "0612345678" } }, { actor: secretary.actor }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("destructive actions", () => {
  it("refuses to plan a confirmation whose arguments are not concrete", async () => {
    stubPlanner({
      toolCalls: [
        { tool: "search_patient", args: { name: "Ana" } },
        {
          tool: "create_appointment",
          args: { patientId: "<PATIENT_ID>", doctorId, date: tomorrowAt(10).toISODate(), time: "10:00", motif: "Follow-up visit" },
        },
      ],
    });
    const before = await AgentPendingActionModel.countDocuments();

    const res = await api().post(`${API}/agent/execute`).set(auth(secretary)).send({ prompt: "Book Ana tomorrow at 10" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing concrete details/i);
    expect(await AgentPendingActionModel.countDocuments()).toBe(before);
  });

  it("asks for confirmation, executes once under concurrent confirms, and keeps existing notes", async () => {
    const patient = await createPatient({ createdBy: admin.id, assignedStaff: [secretary.id] });
    const appointment = await appointmentsService.create({
      actor: secretary.actor, patientId: patient._id.toString(), doctorId,
      startAt: tomorrowAt(10).toJSDate(), reason: "Checkup", notes: "Bring previous results",
    });
    stubPlanner({
      toolCalls: [{ tool: "cancel_appointment", args: { appointmentId: appointment._id.toString(), reason: "patient rescheduling" } }],
    });

    const planned = await api().post(`${API}/agent/execute`).set(auth(secretary)).send({ prompt: "Cancel that appointment" });
    expect(planned.status).toBe(200);
    expect(planned.body.data.requiresConfirmation).toBe(true);

    const confirmPath = `${API}/agent/actions/${planned.body.data.pendingActionId}/confirm`;
    const results = await Promise.all([1, 2].map(() => api().post(confirmPath).set(auth(secretary)).send({ approved: true })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const stored = await AppointmentModel.findById(appointment._id);
    expect(stored?.status).toBe("cancelled");
    expect(stored?.notes).toBe("Bring previous results\nCancellation reason: patient rescheduling");
  });

  it("runs a confirmed action exactly as approved, never swapping in a patient", async () => {
    await createPatient({ createdBy: admin.id, assignedStaff: [secretary.id], firstName: "Ana" });
    vi.spyOn(llmRouter, "generate").mockResolvedValue({ provider: "gemini", text: "Summary." });
    const pending = await AgentPendingActionModel.create({
      actorId: new Types.ObjectId(secretary.id), actorRole: "secretary", prompt: "legacy", status: "pending",
      expiresAt: new Date(Date.now() + 3_600_000),
      toolCalls: [
        { tool: "search_patient", args: { name: "Ana" } },
        { tool: "create_appointment", args: { patientId: "<PATIENT_ID>", doctorId, date: tomorrowAt(12).toISODate(), time: "12:00", motif: "Follow-up" } },
      ],
    });
    const appointmentsBefore = await AppointmentModel.countDocuments();

    const res = await api().post(`${API}/agent/actions/${pending._id}/confirm`).set(auth(secretary)).send({ approved: true });

    expect(res.status).toBe(400);
    expect(await AppointmentModel.countDocuments()).toBe(appointmentsBefore);
    expect((await AgentPendingActionModel.findById(pending._id))?.status).toBe("failed");
  });

  it("only lets the original requester confirm", async () => {
    const pending = await AgentPendingActionModel.create({
      actorId: new Types.ObjectId(secretary.id), actorRole: "secretary", prompt: "x", status: "pending",
      expiresAt: new Date(Date.now() + 3_600_000),
      toolCalls: [{ tool: "delete_patient_note", args: { noteId: new Types.ObjectId().toString() } }],
    });

    const res = await api().post(`${API}/agent/actions/${pending._id}/confirm`).set(auth(admin)).send({ approved: true });
    expect(res.status).toBe(403);
  });
});
