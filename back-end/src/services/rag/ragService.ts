import crypto from "crypto";
import { env } from "../../config/env";
import type { IAIContextChunk, IAIRecordDocument } from "../../models/AIRecord";
import { geminiClient } from "../llm/geminiClient";
import { ensureQdrantCollection, qdrantClient } from "./qdrantClient";
import type { ParsedDocument } from "../files/documentParser";
import { ApiError } from "../../utils/apiError";
import type { UserRole } from "../../types/auth";

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

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

function chunkText(value: string, chunkSize: number, overlap: number): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const sentences = splitSentences(normalized);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + " " + sentence).trim().length <= chunkSize) {
      currentChunk = (currentChunk + " " + sentence).trim();
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      if (sentence.length > chunkSize) {
        for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
          chunks.push(sentence.slice(i, i + chunkSize).trim());
        }
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

// Qdrant only accepts unsigned integers or UUIDs as point IDs, so derive a stable
// UUID (RFC 4122 v5 layout) from our own key. The original key is kept in the payload.
function toPointId(key: string): string {
  const bytes = crypto.createHash("sha1").update(`mediassist:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

// Qdrant client 1.19 removed search(); query() is the replacement (Qdrant server 1.10+).
type ScoredPoints = Awaited<ReturnType<typeof qdrantClient.query>>["points"];

function mapSearchResultsToChunks(
  results: ScoredPoints,
  defaultLabel: string,
): IAIContextChunk[] {
  return results
    .map((item) => {
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      const content = typeof payload.content === "string" ? payload.content : "";

      return {
        sourceId: normalizePointId(item.id),
        content,
        score: item.score ?? 0,
        sourceLabel: typeof payload.sourceLabel === "string" ? payload.sourceLabel : defaultLabel,
        metadata: payload,
      } satisfies IAIContextChunk;
    })
    .filter((chunk) => chunk.content.length > 0);
}

export const ragService = {
  async retrieveContext(patientId: string, query: string, limit = 3): Promise<IAIContextChunk[]> {
    let results: ScoredPoints;

    try {
      await ensureQdrantCollection();
      const queryVector = await geminiClient.embedText(query);

      ({ points: results } = await qdrantClient.query(env.QDRANT_COLLECTION, {
        query: queryVector,
        limit,
        with_payload: true,
        filter: {
          must: [
            {
              key: "scope",
              match: { value: "patient" },
            },
            {
              key: "patientId",
              match: { value: patientId },
            },
          ],
        },
      }));
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(502, `RAG retrieval failed: ${unknownErrorMessage(error)}`, {
        collection: env.QDRANT_COLLECTION,
      });
    }

    return mapSearchResultsToChunks(results, "qdrant_patient_context");
  },

  async retrieveGlobalContext(query: string, limit = 5): Promise<IAIContextChunk[]> {
    let results: ScoredPoints;

    try {
      await ensureQdrantCollection();
      const queryVector = await geminiClient.embedText(query);

      ({ points: results } = await qdrantClient.query(env.QDRANT_COLLECTION, {
        query: queryVector,
        limit,
        with_payload: true,
        filter: {
          must: [
            {
              key: "scope",
              match: { value: "global" },
            },
          ],
        },
      }));
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(502, `Global RAG retrieval failed: ${unknownErrorMessage(error)}`, {
        collection: env.QDRANT_COLLECTION,
      });
    }

    return mapSearchResultsToChunks(results, "qdrant_global_context");
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
          id: toPointId(`record:${record._id.toString()}`),
          vector: embedding,
          payload: {
            pointKey: `record:${record._id.toString()}`,
            scope: "patient",
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
        const pointKey = `${input.record._id.toString()}:file:${docIndex}:${chunkIndex}`;

        points.push({
          id: toPointId(pointKey),
          vector: embedding,
          payload: {
            pointKey,
            scope: "patient",
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

  async indexGlobalDocuments(input: {
    documents: ParsedDocument[];
    actorId: string;
    actorRole: UserRole;
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

        const pointKey = `global:${Date.now()}:${docIndex}:${chunkIndex}:${crypto.randomUUID()}`;

        points.push({
          id: toPointId(pointKey),
          vector: embedding,
          payload: {
            pointKey,
            scope: "global",
            content: chunk,
            sourceLabel: `global_file_${doc.extension.replace(/^\./, "")}`,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            fileExtension: doc.extension,
            chunkIndex,
            createdBy: input.actorId,
            createdByRole: input.actorRole,
            createdAt: new Date().toISOString(),
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