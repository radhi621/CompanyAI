import { env } from "../../config/env";
import type { IAIContextChunk, IAIRecordDocument } from "../../models/AIRecord";
import { geminiClient } from "../llm/geminiClient";
import { ensureQdrantCollection, qdrantClient } from "./qdrantClient";
import type { ParsedDocument } from "../files/documentParser";
import { ApiError } from "../../utils/apiError";

const MAX_EMBEDDING_TEXT_CHARS = 6000;
const UPLOAD_CHUNK_SIZE = 1400;
const UPLOAD_CHUNK_OVERLAP = 180;
const MAX_UPLOAD_CHUNKS_PER_RECORD = 40;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function chunkText(value: string, chunkSize: number, overlap: number): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function normalizePointId(pointId: unknown): string {
  if (typeof pointId === "string" || typeof pointId === "number") {
    return String(pointId);
  }

  if (pointId && typeof pointId === "object") {
    return JSON.stringify(pointId);
  }

  return "unknown-id";
}

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const ragService = {
  async retrieveContext(patientId: string, query: string, limit = 3): Promise<IAIContextChunk[]> {
    let results: Awaited<ReturnType<typeof qdrantClient.search>>;

    try {
      await ensureQdrantCollection();
      const queryVector = await geminiClient.embedText(query);

      results = await qdrantClient.search(env.QDRANT_COLLECTION, {
        vector: queryVector,
        limit,
        with_payload: true,
        filter: {
          must: [
            {
              key: "patientId",
              match: { value: patientId },
            },
          ],
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(502, `RAG retrieval failed: ${unknownErrorMessage(error)}`, {
        collection: env.QDRANT_COLLECTION,
      });
    }

    return results
      .map((item) => {
        const payload = (item.payload ?? {}) as Record<string, unknown>;
        const content = typeof payload.content === "string" ? payload.content : "";

        return {
          sourceId: normalizePointId(item.id),
          content,
          score: item.score ?? 0,
          sourceLabel:
            typeof payload.sourceLabel === "string" ? payload.sourceLabel : "qdrant_patient_context",
          metadata: payload,
        } satisfies IAIContextChunk;
      })
      .filter((chunk) => chunk.content.length > 0);
  },

  async indexRecord(record: IAIRecordDocument): Promise<void> {
    await ensureQdrantCollection();

    const embedding = await geminiClient.embedText(
      `Prompt: ${record.prompt}\n\nResponse: ${record.response}`,
    );

    await qdrantClient.upsert(env.QDRANT_COLLECTION, {
      wait: true,
      points: [
        {
          id: record._id.toString(),
          vector: embedding,
          payload: {
            patientId: record.patientId.toString(),
            recordId: record._id.toString(),
            content: record.response,
            prompt: record.prompt,
            sourceLabel: `ai_record_${record.mode}`,
            createdBy: record.createdBy.toString(),
            createdByRole: record.createdByRole,
            createdAt: record.createdAt.toISOString(),
          },
        },
      ],
    });
  },

  async indexUploadedFileChunks(input: {
    record: IAIRecordDocument;
    documents: ParsedDocument[];
  }): Promise<Array<{ fileName: string; chunkCount: number }>> {
    await ensureQdrantCollection();

    const points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }> = [];
    const chunkStats: Array<{ fileName: string; chunkCount: number }> = [];

    let totalChunks = 0;

    for (let docIndex = 0; docIndex < input.documents.length; docIndex += 1) {
      const doc = input.documents[docIndex];
      const chunks = chunkText(doc.text, UPLOAD_CHUNK_SIZE, UPLOAD_CHUNK_OVERLAP);
      const limitedChunks = chunks.slice(0, Math.max(0, MAX_UPLOAD_CHUNKS_PER_RECORD - totalChunks));

      chunkStats.push({
        fileName: doc.fileName,
        chunkCount: limitedChunks.length,
      });

      for (let chunkIndex = 0; chunkIndex < limitedChunks.length; chunkIndex += 1) {
        const chunk = limitedChunks[chunkIndex];
        const embedding = await geminiClient.embedText(truncateText(chunk, MAX_EMBEDDING_TEXT_CHARS));

        points.push({
          id: `${input.record._id.toString()}:file:${docIndex}:${chunkIndex}`,
          vector: embedding,
          payload: {
            patientId: input.record.patientId.toString(),
            recordId: input.record._id.toString(),
            content: chunk,
            sourceLabel: `uploaded_file_${doc.extension.replace(/^\./, "")}`,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            fileExtension: doc.extension,
            chunkIndex,
            createdBy: input.record.createdBy.toString(),
            createdByRole: input.record.createdByRole,
            createdAt: input.record.createdAt.toISOString(),
          },
        });
      }

      totalChunks += limitedChunks.length;
      if (totalChunks >= MAX_UPLOAD_CHUNKS_PER_RECORD) {
        break;
      }
    }

    if (points.length > 0) {
      await qdrantClient.upsert(env.QDRANT_COLLECTION, {
        wait: true,
        points,
      });
    }

    return chunkStats;
  },

  async deleteRecordVector(recordId: string): Promise<void> {
    await ensureQdrantCollection();
    await qdrantClient.delete(env.QDRANT_COLLECTION, {
      wait: true,
      filter: {
        must: [
          {
            key: "recordId",
            match: { value: recordId },
          },
        ],
      },
    });
  },
};

export const formatRagContext = (chunks: IAIContextChunk[]): string => {
  if (chunks.length === 0) {
    return "No RAG context found for this patient.";
  }

  return chunks
    .map((chunk, index) => {
      return `Context ${index + 1} | Source: ${chunk.sourceLabel} | Score: ${chunk.score.toFixed(4)}\n${chunk.content}`;
    })
    .join("\n\n");
};