import { DateTime } from "luxon";
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { AgentPendingActionModel } from "../src/models/AgentPendingAction";
import { PatientNoteModel } from "../src/models/PatientNote";
import { describePendingAction } from "../src/modules/agent/agent.confirmation";
import { buildFallbackAnswer } from "../src/modules/agent/agent.fallbackAnswer";
import { llmRouter } from "../src/services/llm/llmRouter";
import { ragService } from "../src/services/rag/ragService";
import { ApiError } from "../src/utils/apiError";
import { API, type TestSession, api, auth, createPatient, createSession } from "./helpers";

const isPlannerPrompt = (prompt: string) => prompt.startsWith("You are an orchestration planner");

let admin: TestSession;

async function patientWithNote() {
  admin = await createSession("admin");
  const patient = await createPatient({ createdBy: admin.id, firstName: "Leila", lastName: "Mansouri" });
  return addNote(patient._id.toString());
}

async function addNote(patientId: string) {
  await PatientNoteModel.create({
    patientId: new Types.ObjectId(patientId),
    content: "Reports 3-4 migraine episodes per month, mostly in the morning.",
    createdBy: new Types.ObjectId(admin.id),
    createdByRole: "admin",
  });
  return patientId;
}

function execute(prompt: string) {
  return api().post(`${API}/agent/execute`).set(auth(admin)).send({ prompt });
}

let recordSearches: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  recordSearches = vi.spyOn(ragService, "retrieveContext").mockResolvedValue([]);
});

describe("agent answers", () => {
  it("runs the requested tool after looking up a named patient, without a file search", async () => {
    const patientId = await patientWithNote();
    const plannerPrompts: string[] = [];
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => {
      if (!isPlannerPrompt(prompt)) {
        return { provider: "gemini", text: "Total notes: 1" };
      }
      plannerPrompts.push(prompt);
      // First turn: only the ID is unknown, so only the lookup. Second turn: the notes tool.
      const plan = prompt.includes("Patient lookup result")
        ? { toolCalls: [{ tool: "list_patient_notes", args: { patientId } }] }
        : { toolCalls: [{ tool: "search_patient", args: { name: "Leila Mansouri" } }] };
      return { provider: "gemini", text: JSON.stringify(plan) };
    });

    const res = await execute("List all notes for the patient Leila Mansouri");

    expect(res.status).toBe(200);
    expect(plannerPrompts).toHaveLength(2);
    expect(plannerPrompts[1]).toContain(`the patient's ID is ${patientId}`);
    expect(res.body.data.results.map((r: { tool: string }) => r.tool)).toEqual(["search_patient", "list_patient_notes"]);
    expect(res.body.data.results[1].result.notes[0].content).toMatch(/migraine episodes/);
    expect(res.body.data.autoChainedToolCalls).toEqual([]);
    expect(recordSearches).not.toHaveBeenCalled();
    expect(res.body.data.finalMessage).toBe("Total notes: 1");
  });

  it("does not add a file search when the planner already chose a listing tool", async () => {
    const patientId = await patientWithNote();
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => ({
      provider: "gemini",
      text: isPlannerPrompt(prompt)
        ? JSON.stringify({ toolCalls: [{ tool: "list_patient_notes", args: { patientId } }] })
        : "Total notes: 1",
    }));

    const res = await execute(`List all notes for patient ${patientId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.results.map((r: { tool: string }) => r.tool)).toEqual(["list_patient_notes"]);
    expect(recordSearches).not.toHaveBeenCalled();
  });

  it("shows the data itself when no provider can write the answer", async () => {
    const patientId = await patientWithNote();
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => {
      if (isPlannerPrompt(prompt)) {
        return {
          provider: "gemini",
          text: JSON.stringify({
            toolCalls: [{ tool: "list_patient_notes", args: { patientId } }],
            finalMessage: "I will list the notes.",
          }),
        };
      }
      throw new ApiError(502, "All LLM providers failed");
    });

    const res = await execute(`List all notes for patient ${patientId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.writerProvider).toBeNull();
    expect(res.body.data.finalMessage).toContain("Reports 3-4 migraine episodes per month");
    expect(res.body.data.finalMessage).not.toContain("I will list the notes.");
    expect(res.body.data.finalMessage).not.toContain("Review tool results");
  });

  it("reports which provider wrote the answer", async () => {
    const patientId = await patientWithNote();
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) =>
      isPlannerPrompt(prompt)
        ? { provider: "gemini", text: JSON.stringify({ toolCalls: [{ tool: "list_patient_notes", args: { patientId } }] }) }
        : { provider: "groq", text: "Total notes: 1" },
    );

    const res = await execute(`List all notes for patient ${patientId}`);

    expect(res.body.data.provider).toBe("gemini");
    expect(res.body.data.writerProvider).toBe("groq");
  });
});

describe("buildFallbackAnswer", () => {
  it("renders lists as tables with the ID last", () => {
    const text = buildFallbackAnswer([
      {
        tool: "search_patient",
        result: {
          total: 1,
          patients: [{ _id: "6ac7f8e295fc5deac8262ee7", firstName: "Leila", lastName: "Mansouri", cin: "DEMO1005", pathologies: ["Migraine"] }],
        },
      },
    ]);

    expect(text).toContain("| First Name | Last Name | Cin | Pathologies | Id |");
    expect(text).toContain("| Leila | Mansouri | DEMO1005 | Migraine | `6ac7f8e295fc5deac8262ee7` |");
  });

  it("keeps table cells on one line and escapes pipes", () => {
    const text = buildFallbackAnswer([
      { tool: "list_patient_notes", result: { notes: [{ noteId: "n1", content: "Line one\nLine | two" }] } },
    ]);

    expect(text).toContain("| Line one Line / two | `n1` |");
  });

  it("says when a list is empty and renders single records as labelled lines", () => {
    expect(buildFallbackAnswer([{ tool: "list_patient_notes", result: { total: 0, notes: [] } }])).toContain(
      "No notes found.",
    );
    expect(
      buildFallbackAnswer([{ tool: "check_availability", result: { available: true, date: "2026-10-12T09:00:00.000Z" } }]),
    ).toContain("- **Available:** true\n- **Date:** 2026-10-12");
  });
});

describe("requests that need several steps", () => {
  /** Plans each turn from the results so far, like the model would for "delete Salma's last note". */
  function plannerForDeleteLastNote(plannerPrompts: string[]) {
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => {
      if (!isPlannerPrompt(prompt)) {
        return { provider: "gemini", text: "Summary." };
      }
      plannerPrompts.push(prompt);
      const patientId = /the patient's ID is ([a-f0-9]{24})/.exec(prompt)?.[1];
      const noteId = /"noteId": "([a-f0-9]{24})"/.exec(prompt)?.[1];
      const plan = noteId
        ? { toolCalls: [{ tool: "delete_patient_note", args: { noteId } }] }
        : patientId
          ? { toolCalls: [{ tool: "list_patient_notes", args: { patientId } }], followUp: true }
          : { toolCalls: [{ tool: "search_patient", args: { name: "Salma Berrada" } }] };
      return { provider: "gemini", text: JSON.stringify(plan) };
    });
  }

  it("finds the patient, lists her notes, then asks to confirm deleting the right note", async () => {
    // A name no other test uses, so the lookup finds exactly one patient.
    admin = await createSession("admin");
    const patient = await createPatient({ createdBy: admin.id, firstName: "Salma", lastName: "Berrada" });
    const patientId = await addNote(patient._id.toString());
    const plannerPrompts: string[] = [];
    plannerForDeleteLastNote(plannerPrompts);

    const res = await execute("Delete the last note of Salma Berrada");

    expect(res.status).toBe(200);
    expect(plannerPrompts).toHaveLength(3);
    const data = res.body.data;
    expect(data.requiresConfirmation).toBe(true);
    expect(data.results.map((r: { tool: string }) => r.tool)).toEqual(["search_patient", "list_patient_notes"]);
    const noteId = data.results[1].result.notes[0].noteId;
    expect(data.plannedToolCalls).toEqual([{ tool: "delete_patient_note", args: { noteId } }]);
    // The user sees which note before approving.
    expect(data.message).toContain(`noteId \`${noteId}\``);
    expect(data.message).toContain("Reports 3-4 migraine episodes per month");

    // Nothing is deleted until the user approves, and then only that note.
    expect(await PatientNoteModel.countDocuments({ patientId, deletedAt: { $exists: false } })).toBe(1);
    const pending = await AgentPendingActionModel.findById(data.pendingActionId);
    expect(pending?.toolCalls.map((call) => call.tool)).toEqual(["delete_patient_note"]);

    const confirmed = await api()
      .post(`${API}/agent/actions/${data.pendingActionId}/confirm`)
      .set(auth(admin))
      .send({ approved: true });
    expect(confirmed.status).toBe(200);
    expect((await PatientNoteModel.findById(noteId))?.deletedAt).toBeTruthy();
  });

  it("does not repeat calls already made in a later turn", async () => {
    const patientId = await patientWithNote();
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => {
      if (!isPlannerPrompt(prompt)) {
        return { provider: "gemini", text: "Summary." };
      }
      // Every turn asks for the same listing and more steps.
      return {
        provider: "gemini",
        text: JSON.stringify({ toolCalls: [{ tool: "list_patient_notes", args: { patientId } }], followUp: true }),
      };
    });

    const res = await execute(`List all notes for patient ${patientId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.results.map((r: { tool: string }) => r.tool)).toEqual(["list_patient_notes"]);
  });

  it("plans only one turn when the planner does not ask for more", async () => {
    const patientId = await patientWithNote();
    let plannerCalls = 0;
    vi.spyOn(llmRouter, "generate").mockImplementation(async (prompt: string) => {
      if (!isPlannerPrompt(prompt)) {
        return { provider: "gemini", text: "Summary." };
      }
      plannerCalls += 1;
      return { provider: "gemini", text: JSON.stringify({ toolCalls: [{ tool: "list_patient_notes", args: { patientId } }] }) };
    });

    await execute(`List all notes for patient ${patientId}`);

    expect(plannerCalls).toBe(1);
  });
});

describe("describePendingAction", () => {
  it("names the record each action targets, with its date (clinic time), author and text", () => {
    const noteId = "6ac7f8e295fc5deac8262eec";
    const createdAt = new Date("2026-10-08T09:30:00Z");
    // Morocco's UTC offset depends on the tz database version, so compute the expected time.
    const clinicTime = DateTime.fromJSDate(createdAt).setZone(env.APP_TIMEZONE).toFormat("yyyy-MM-dd HH:mm");
    const text = describePendingAction(
      [{ tool: "delete_patient_note", args: { noteId } }],
      [
        {
          tool: "list_patient_notes",
          args: {},
          result: {
            notes: [
              { noteId, content: "Reports 3-4 migraine episodes per month.", createdBy: "Nadia Bennani", createdAt },
            ],
          },
        },
      ],
    );

    expect(text).toContain(
      `- **delete_patient_note**: noteId \`${noteId}\` (${clinicTime}, Nadia Bennani, "Reports 3-4 migraine episodes per month.")`,
    );
  });

  it("shows the arguments when the target is not in the results", () => {
    const text = describePendingAction([{ tool: "cancel_appointment", args: { appointmentId: "6ac7f8e295fc5deac8262eed", reason: "Patient ill" } }], []);

    expect(text).toContain("- **cancel_appointment**: appointmentId 6ac7f8e295fc5deac8262eed; reason Patient ill");
  });
});
