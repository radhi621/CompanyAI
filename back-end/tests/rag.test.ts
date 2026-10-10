import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IAIRecordDocument } from "../src/models/AIRecord";
import { geminiClient } from "../src/services/llm/geminiClient";
import { qdrantClient } from "../src/services/rag/qdrantClient";
import { ragService } from "../src/services/rag/ragService";

// Qdrant only accepts unsigned integers or UUIDs as point IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type UpsertArgs = Parameters<typeof qdrantClient.upsert>;

let upserts: UpsertArgs[];

beforeEach(() => {
  upserts = [];
  vi.spyOn(qdrantClient, "collectionExists").mockResolvedValue({ exists: true } as never);
  vi.spyOn(qdrantClient, "createPayloadIndex").mockResolvedValue({} as never);
  vi.spyOn(qdrantClient, "upsert").mockImplementation(async (...args: UpsertArgs) => {
    upserts.push(args);
    return {} as never;
  });
  vi.spyOn(geminiClient, "embedText").mockResolvedValue(new Array(768).fill(0.1));
});

const fakeRecord = () =>
  ({
    _id: new Types.ObjectId(),
    patientId: new Types.ObjectId(),
    prompt: "Summarize allergies",
    response: "Allergic to penicillin.",
    mode: "rag",
    createdBy: new Types.ObjectId(),
    createdByRole: "doctor",
    createdAt: new Date(),
  }) as unknown as IAIRecordDocument;

const pointsOf = (call: UpsertArgs) => (call[1] as { points: Array<{ id: string; payload: Record<string, unknown> }> }).points;

describe("Qdrant point IDs", () => {
  it("indexes a record under a stable UUID and keeps the original key in the payload", async () => {
    const record = fakeRecord();
    await ragService.indexRecord(record);
    await ragService.indexRecord(record);

    const [first, second] = upserts.map((call) => pointsOf(call)[0]);
    expect(first.id).toMatch(UUID);
    expect(second.id).toBe(first.id); // re-indexing overwrites instead of duplicating
    expect(first.payload.pointKey).toBe(`record:${record._id.toString()}`);
  });

  it("uses distinct UUIDs for uploaded file chunks and global documents", async () => {
    const record = fakeRecord();
    const longText = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about blood pressure.`).join(" ");
    const doc = { fileName: "a.txt", extension: ".txt", mimeType: "text/plain", sizeBytes: 10, text: longText };

    await ragService.indexUploadedFileChunks({ record, documents: [doc] });
    await ragService.indexGlobalDocuments({ documents: [doc], actorId: new Types.ObjectId().toString(), actorRole: "admin" });

    const ids = upserts.flatMap((call) => pointsOf(call).map((point) => point.id));
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
