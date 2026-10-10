import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PatientNoteModel } from "../src/models/PatientNote";
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
  await PatientNoteModel.create({
    patientId: patient._id,
    content: "Reports 3-4 migraine episodes per month, mostly in the morning.",
    createdBy: new Types.ObjectId(admin.id),
    createdByRole: "admin",
  });
  return patient._id.toString();
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
