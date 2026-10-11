import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRecordModel } from "../src/models/AIRecord";
import { geminiClient } from "../src/services/llm/geminiClient";
import { llmRouter } from "../src/services/llm/llmRouter";
import { qdrantClient } from "../src/services/rag/qdrantClient";
import { API, api, auth, createPatient, createSession, type TestSession } from "./helpers";

type DeleteArgs = Parameters<typeof qdrantClient.delete>;

let vectorDeletes: DeleteArgs[];

beforeEach(() => {
  vectorDeletes = [];
  vi.spyOn(qdrantClient, "collectionExists").mockResolvedValue({ exists: true } as never);
  vi.spyOn(qdrantClient, "createPayloadIndex").mockResolvedValue({} as never);
  vi.spyOn(qdrantClient, "upsert").mockResolvedValue({} as never);
  vi.spyOn(qdrantClient, "query").mockResolvedValue({ points: [] } as never);
  vi.spyOn(qdrantClient, "delete").mockImplementation(async (...args: DeleteArgs) => {
    vectorDeletes.push(args);
    return {} as never;
  });
  vi.spyOn(geminiClient, "embedText").mockResolvedValue(new Array(768).fill(0.1));
  vi.spyOn(llmRouter, "generate").mockResolvedValue({ provider: "gemini", text: "Summary of the document." });
});

const deletedRecordIds = () =>
  vectorDeletes.map((call) => (call[1] as { filter: { must: Array<{ match: { value: string } }> } }).filter.must[0].match.value);

function upload(session: TestSession, patientId: string, fileName: string, text = "Allergic to ibuprofen.") {
  return api()
    .post(`${API}/ai/records/upload`)
    .set(auth(session))
    .field("patientId", patientId)
    .field("mode", "rag")
    .attach("files", Buffer.from(text), { filename: fileName, contentType: "text/plain" });
}

function listFiles(session: TestSession, patientId: string) {
  return api().get(`${API}/ai/records`).query({ patientId, hasFiles: "true" }).set(auth(session));
}

async function setup() {
  const admin = await createSession("admin");
  const doctor = await createSession("doctor");
  const patient = await createPatient({ createdBy: admin.id, assignedStaff: [doctor.id] });
  return { admin, doctor, patientId: patient._id.toString() };
}

describe("patient RAG files", () => {
  it("lists a patient's uploaded files, with chunk counts and the uploader", async () => {
    const { doctor, patientId } = await setup();
    expect((await upload(doctor, patientId, "record.txt")).status).toBe(201);

    // A record generated from a prompt has no files and is left out of the list.
    await AIRecordModel.create({
      patientId: new Types.ObjectId(patientId),
      prompt: "Summarize",
      response: "Summary",
      mode: "non_rag",
      provider: "gemini",
      createdBy: new Types.ObjectId(doctor.id),
      createdByRole: "doctor",
    });

    const res = await listFiles(doctor, patientId);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const [record] = res.body.data;
    expect(record.sourceFiles[0]).toMatchObject({ fileName: "record.txt", mimeType: "text/plain", chunkCount: 1 });
    expect(record.createdBy).toMatchObject({ name: "Test doctor", role: "doctor" });
    expect(record.contextChunks).toBeUndefined();
  });

  it("refuses the list to staff not assigned to the patient", async () => {
    const { patientId } = await setup();
    const otherDoctor = await createSession("doctor");

    expect((await listFiles(otherDoctor, patientId)).status).toBe(403);
  });

  it("deletes an upload and its vectors", async () => {
    const { doctor, patientId } = await setup();
    const recordId = (await upload(doctor, patientId, "record.txt")).body.data._id;

    const res = await api().delete(`${API}/ai/records/${recordId}`).set(auth(doctor));

    expect(res.status).toBe(200);
    expect(deletedRecordIds()).toEqual([recordId]);
    expect((await listFiles(doctor, patientId)).body.data).toHaveLength(0);
  });

  it("replaces an upload with new files and removes the old vectors", async () => {
    const { doctor, patientId } = await setup();
    const oldId = (await upload(doctor, patientId, "old.txt")).body.data._id;

    const res = await api()
      .post(`${API}/ai/records/${oldId}/replace`)
      .set(auth(doctor))
      .attach("files", Buffer.from("Updated: allergic to ibuprofen and latex."), {
        filename: "new.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(201);
    expect(res.body.data._id).not.toBe(oldId);
    expect(res.body.data.patientId).toBe(patientId);
    expect(deletedRecordIds()).toEqual([oldId]);

    const files = (await listFiles(doctor, patientId)).body.data;
    expect(files.map((record: { sourceFiles: Array<{ fileName: string }> }) => record.sourceFiles[0].fileName)).toEqual([
      "new.txt",
    ]);
  });

  it("keeps the original when the replacement fails", async () => {
    const { doctor, patientId } = await setup();
    const oldId = (await upload(doctor, patientId, "old.txt")).body.data._id;

    vi.spyOn(llmRouter, "generate").mockRejectedValue(new Error("All AI providers failed"));
    const res = await api()
      .post(`${API}/ai/records/${oldId}/replace`)
      .set(auth(doctor))
      .attach("files", Buffer.from("New text"), { filename: "new.txt", contentType: "text/plain" });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(vectorDeletes).toHaveLength(0);
    const files = (await listFiles(doctor, patientId)).body.data;
    expect(files.map((record: { _id: string }) => record._id)).toEqual([oldId]);
  });

  it("requires a file to replace with", async () => {
    const { doctor, patientId } = await setup();
    const oldId = (await upload(doctor, patientId, "old.txt")).body.data._id;

    const res = await api().post(`${API}/ai/records/${oldId}/replace`).set(auth(doctor));

    expect(res.status).toBe(400);
    expect(vectorDeletes).toHaveLength(0);
  });

  it("lets only the uploader or a higher role delete or replace", async () => {
    const admin = await createSession("admin");
    const doctor = await createSession("doctor");
    const nurse = await createSession("nurse");
    const patientId = (
      await createPatient({ createdBy: admin.id, assignedStaff: [doctor.id, nurse.id] })
    )._id.toString();
    const recordId = (await upload(doctor, patientId, "record.txt")).body.data._id;

    const nurseDelete = await api().delete(`${API}/ai/records/${recordId}`).set(auth(nurse));
    const nurseReplace = await api()
      .post(`${API}/ai/records/${recordId}/replace`)
      .set(auth(nurse))
      .attach("files", Buffer.from("x"), { filename: "x.txt", contentType: "text/plain" });

    // Assigned to the patient, but a lower role than the doctor who uploaded it.
    expect(nurseDelete.status).toBe(403);
    expect(nurseDelete.body.message).toBe("Only the owner or a higher role can modify this record");
    expect(nurseReplace.status).toBe(403);
    expect(vectorDeletes).toHaveLength(0);

    // The admin outranks the doctor who uploaded it.
    expect((await api().delete(`${API}/ai/records/${recordId}`).set(auth(admin))).status).toBe(200);
  });
});
