import { DateTime } from "luxon";
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { AgentConversationModel } from "../src/models/AgentConversation";
import { AgentPendingActionModel } from "../src/models/AgentPendingAction";
import { PatientNoteModel } from "../src/models/PatientNote";
import { toStoredResult } from "../src/modules/agent/agent.chat";
import { getChatTools, isToolAllowedForRole } from "../src/modules/agent/agent.tools";
import type { ChatMessage, ChatRequest, ChatTurn } from "../src/services/llm/chatTypes";
import { llmRouter } from "../src/services/llm/llmRouter";
import { ApiError } from "../src/utils/apiError";
import { API, type TestSession, api, auth, createPatient, createSession } from "./helpers";

type Step = (request: ChatRequest) => ChatTurn;

let requests: ChatRequest[];

/** Scripts the model: each call to llmRouter.chat runs the next step (the last one repeats). */
function scriptModel(...steps: Step[]) {
  requests = [];
  let index = 0;
  return vi.spyOn(llmRouter, "chat").mockImplementation(async (request: ChatRequest) => {
    requests.push(structuredClone(request));
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    return { provider: "gemini", turn: step(request) };
  });
}

const answer = (text: string): Step => () => ({ text, toolCalls: [] });
const call = (name: string, args: Record<string, unknown>, id = `call-${name}`): Step => () => ({
  text: null,
  toolCalls: [{ id, name, args }],
});

/** The result the model received for its last tool call. */
const lastToolResult = (request: ChatRequest) =>
  (request.messages.filter((message) => message.role === "tool").at(-1) as Extract<ChatMessage, { role: "tool" }>).result;

let admin: TestSession;
let conversationCounter = 0;

function send(session: TestSession, prompt: string, conversationId: string, patientId?: string) {
  return api()
    .post(`${API}/agent/execute`)
    .set(auth(session))
    .send({ prompt, conversationId, ...(patientId ? { patientId } : {}) });
}

async function patientWithNote(firstName = "Leila", lastName = "Mansouri") {
  const patient = await createPatient({ createdBy: admin.id, firstName, lastName });
  const note = await PatientNoteModel.create({
    patientId: patient._id,
    content: "Reports 3-4 migraine episodes per month, mostly in the morning.",
    createdBy: new Types.ObjectId(admin.id),
    createdByRole: "admin",
  });
  return { patientId: patient._id.toString(), noteId: note._id.toString() };
}

beforeEach(async () => {
  admin = await createSession("admin");
  conversationCounter += 1;
});

const conversation = () => `chat-${conversationCounter}`;

describe("assistant conversation", () => {
  it("answers, and stores the exchange as the conversation", async () => {
    scriptModel(answer("Hello! How can I help?"));

    const res = await send(admin, "hi", conversation());

    expect(res.status).toBe(200);
    expect(res.body.data.finalMessage).toBe("Hello! How can I help?");
    const stored = await AgentConversationModel.findOne({ conversationId: conversation() });
    expect(stored?.messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello! How can I help?" },
    ]);
  });

  it("calls tools, gives the model their results, and answers from them", async () => {
    const { patientId } = await patientWithNote();
    scriptModel(call("list_patient_notes", { patientId }), (request) => {
      const result = lastToolResult(request) as { notes: Array<{ content: string }> };
      return { text: `Total notes: ${result.notes.length}. ${result.notes[0].content}`, toolCalls: [] };
    });

    const res = await send(admin, "List her notes", conversation(), patientId);

    expect(res.status).toBe(200);
    expect(res.body.data.finalMessage).toMatch(/^Total notes: 1\. Reports 3-4 migraine/);
    expect(res.body.data.results.map((r: { tool: string }) => r.tool)).toEqual(["list_patient_notes"]);
  });

  it("remembers earlier messages, tool calls and results for follow-ups", async () => {
    const { patientId } = await patientWithNote();
    scriptModel(call("list_patient_notes", { patientId }), answer("1 note."));
    await send(admin, "List the notes", conversation());

    scriptModel(answer("Yes, that was the complete list."));
    const res = await send(admin, "done?", conversation());

    expect(res.status).toBe(200);
    const roles = requests[0].messages.map((message) => message.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(JSON.stringify(requests[0].messages)).toContain("Reports 3-4 migraine episodes");
    expect(requests[0].messages.at(-1)).toEqual({ role: "user", text: "done?" });
  });

  it("accepts very short messages such as \"ok\"", async () => {
    scriptModel(answer("Okay."));
    expect((await send(admin, "ok", conversation())).status).toBe(200);
  });

  it("keeps each user's conversations separate", async () => {
    scriptModel(answer("First answer."));
    await send(admin, "Something private", conversation());

    const other = await createSession("admin");
    scriptModel(answer("Hello."));
    await send(other, "hi", conversation());

    expect(requests[0].messages).toEqual([{ role: "user", text: "hi" }]);
  });

  it("tells the model about the chat's patient and checks access to it", async () => {
    const { patientId } = await patientWithNote("Salma", "Berrada");
    scriptModel(answer("Okay."));
    await send(admin, "hi", conversation(), patientId);
    expect(requests[0].system).toContain(`patient Salma Berrada`);
    expect(requests[0].system).toContain(patientId);

    const nurse = await createSession("nurse");
    const res = await send(nurse, "hi", `${conversation()}-nurse`, patientId);
    expect(res.status).toBe(403);
  });

  it("gives tool errors back to the model instead of failing the request", async () => {
    const nurse = await createSession("nurse");
    const unassigned = await createPatient({ createdBy: admin.id });
    scriptModel(call("get_patient_summary", { patientId: unassigned._id.toString() }), (request) => ({
      text: `Error seen: ${(lastToolResult(request) as { error: string }).error}`,
      toolCalls: [],
    }));

    const res = await send(nurse, "Summarize that patient", conversation());

    expect(res.status).toBe(200);
    expect(res.body.data.finalMessage).toMatch(/Error seen: .*not assigned/i);
  });

  it("offers each role only the tools it may use", async () => {
    for (const role of ["admin", "doctor", "nurse", "secretary"] as const) {
      for (const tool of getChatTools(role)) {
        expect(isToolAllowedForRole(tool.name as never, role)).toBe(true);
        expect(tool.parameters).toMatchObject({ type: "object" });
        expect(tool.parameters).not.toHaveProperty("$schema");
      }
    }
  });

  it("shows the data when the model fails after tools ran, and keeps nothing when it fails first", async () => {
    const { patientId } = await patientWithNote();
    let calls = 0;
    vi.spyOn(llmRouter, "chat").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return { provider: "gemini", turn: { text: null, toolCalls: [{ id: "c1", name: "list_patient_notes", args: { patientId } }] } };
      }
      throw new ApiError(502, "All LLM providers failed");
    });

    const res = await send(admin, "List the notes", conversation());
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBeNull();
    expect(res.body.data.finalMessage).toContain("Reports 3-4 migraine episodes");

    vi.spyOn(llmRouter, "chat").mockRejectedValue(new ApiError(502, "All LLM providers failed"));
    const failed = await send(admin, "Another question", `${conversation()}-b`);
    expect(failed.status).toBe(502);
    const stored = await AgentConversationModel.findOne({ conversationId: `${conversation()}-b` });
    expect(stored?.messages ?? []).toEqual([]);
  });
});

describe("actions that change data", () => {
  it("finds the patient and the note, asks to confirm, and remembers the outcome", async () => {
    const { patientId, noteId } = await patientWithNote("Nour", "Alaoui");
    scriptModel(
      call("search_patient", { name: "Nour Alaoui" }),
      call("list_patient_notes", { patientId }),
      call("delete_patient_note", { noteId }),
    );

    const res = await send(admin, "Delete the last note of Nour Alaoui", conversation());

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.requiresConfirmation).toBe(true);
    expect(data.plannedToolCalls).toEqual([{ tool: "delete_patient_note", args: { noteId } }]);
    expect(data.message).toContain("**Delete note**");
    expect(data.message).toContain("Reports 3-4 migraine episodes");
    // Nothing changes before approval.
    expect((await PatientNoteModel.findById(noteId))?.deletedAt).toBeUndefined();

    const confirmed = await api().post(`${API}/agent/actions/${data.pendingActionId}/confirm`).set(auth(admin)).send({ approved: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.message).toMatch(/^Done\. The approved action ran:/);
    expect((await PatientNoteModel.findById(noteId))?.deletedAt).toBeTruthy();

    // "done?" afterwards: the model sees the approval and its result in the conversation.
    scriptModel(answer("Yes, the note was deleted."));
    await send(admin, "done?", conversation());
    const history = JSON.stringify(requests[0].messages);
    expect(history).toContain("awaiting_user_approval");
    expect(history).toContain("Done. The approved action ran:");
  });

  it("records a rejection in the conversation", async () => {
    const { noteId } = await patientWithNote();
    scriptModel(call("delete_patient_note", { noteId }));
    const res = await send(admin, `Delete note ${noteId}`, conversation());

    await api().post(`${API}/agent/actions/${res.body.data.pendingActionId}/confirm`).set(auth(admin)).send({ approved: false });

    const stored = await AgentConversationModel.findOne({ conversationId: conversation() });
    expect(stored?.messages.at(-1)).toEqual({
      role: "assistant",
      text: "Rejected: the action was not run and nothing was changed.",
    });
    expect((await PatientNoteModel.findById(noteId))?.deletedAt).toBeUndefined();
  });

  it("returns invalid arguments to the model instead of asking the user to approve them", async () => {
    scriptModel(call("delete_patient_note", { noteId: "<NOTE_ID>" }), (request) => ({
      text: `Problem: ${(lastToolResult(request) as { error: string }).error}`,
      toolCalls: [],
    }));
    const before = await AgentPendingActionModel.countDocuments();

    const res = await send(admin, "Delete that note", conversation());

    expect(res.status).toBe(200);
    expect(res.body.data.requiresConfirmation).toBe(false);
    expect(res.body.data.finalMessage).toMatch(/Problem: Invalid arguments: noteId/);
    expect(await AgentPendingActionModel.countDocuments()).toBe(before);
  });

  it("asks before adding a note or creating a patient too", async () => {
    const { patientId } = await patientWithNote();
    scriptModel(call("update_patient_notes", { patientId, note: "Called the patient back." }));
    const before = await PatientNoteModel.countDocuments({ patientId });

    const res = await send(admin, "Add a note: called the patient back", conversation());

    expect(res.body.data.requiresConfirmation).toBe(true);
    expect(res.body.data.message).toContain("**Add note**");
    expect(await PatientNoteModel.countDocuments({ patientId })).toBe(before);
  });
});

describe("tool results given to the model", () => {
  it("shows timestamps in clinic time, with the offset", () => {
    const stored = toStoredResult({ createdAt: new Date("2026-10-08T20:11:00Z"), date: "2026-10-08" }) as Record<string, string>;
    const expected = DateTime.fromISO("2026-10-08T20:11:00Z").setZone(env.APP_TIMEZONE).toISO({ suppressMilliseconds: true });

    expect(stored.createdAt).toBe(expected);
    expect(stored.createdAt).not.toMatch(/Z$/);
    expect(stored.date).toBe("2026-10-08");
  });
});
