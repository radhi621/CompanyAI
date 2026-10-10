// Search tools over uploaded medical records and global knowledge (Qdrant).
import { Types } from "mongoose";
import { z } from "zod";
import { AIRecordModel } from "../../../models/AIRecord";
import { ragService } from "../../../services/rag/ragService";
import { defineTool, objectIdSchema, extractSearchTerms, scoreTextMatch, truncateResultContent, assertPatientAccess, getAccessiblePatientIds } from "./shared";

export const recordsTools = {
  search_medical_records_RAG: defineTool({
    description: "Performs semantic search in patient indexed records (RAG)",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      query: "required string",
      limit: "optional number",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      query: z.string().min(3).max(2000),
      limit: z.coerce.number().int().positive().max(10).default(5),
    }),
    run: async (args, context) => {
      await assertPatientAccess(context.actor, args.patientId);
      const chunks = await ragService.retrieveContext(args.patientId, args.query, args.limit);

      if (chunks.length > 0) {
        return {
          patientId: args.patientId,
          query: args.query,
          matches: chunks,
        };
      }

      const terms = extractSearchTerms(args.query);
      if (terms.length === 0) {
        return {
          patientId: args.patientId,
          query: args.query,
          matches: [],
          fallbackUsed: "mongo_ai_records",
        };
      }

      const records = await AIRecordModel.find({
        patientId: new Types.ObjectId(args.patientId),
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .select("_id mode provider response contextChunks createdAt");

      const fallbackMatches = records
        .flatMap((record) => {
          const responseText = record.response?.trim() ?? "";
          const responseScore = scoreTextMatch(responseText, terms);

          const responseMatch =
            responseScore > 0
              ? [
                  {
                    sourceId: `record:${record._id.toString()}:response`,
                    content: truncateResultContent(responseText),
                    score: responseScore,
                    sourceLabel: `mongo_record_${record.mode}`,
                    metadata: {
                      recordId: record._id.toString(),
                      provider: record.provider,
                      createdAt: record.createdAt?.toISOString?.(),
                      fallback: true,
                      sourceType: "record_response",
                    },
                  },
                ]
              : [];

          const chunkMatches = record.contextChunks
            .map((chunk, index) => {
              const chunkText = (chunk.content ?? "").trim();
              const chunkScore = scoreTextMatch(chunkText, terms);
              if (chunkScore <= 0) {
                return null;
              }

              return {
                sourceId: `record:${record._id.toString()}:chunk:${index}`,
                content: truncateResultContent(chunkText),
                score: chunkScore,
                sourceLabel: chunk.sourceLabel || `mongo_chunk_${record.mode}`,
                metadata: {
                  ...(chunk.metadata ?? {}),
                  recordId: record._id.toString(),
                  provider: record.provider,
                  createdAt: record.createdAt?.toISOString?.(),
                  fallback: true,
                  sourceType: "context_chunk",
                },
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          return [...responseMatch, ...chunkMatches];
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit);

      return {
        patientId: args.patientId,
        query: args.query,
        matches: fallbackMatches,
        fallbackUsed: "mongo_ai_records",
      };
    },
  }),
  search_global_knowledge_RAG: defineTool({
    description: "Performs semantic search in globally indexed RAG knowledge",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      query: "required string",
      limit: "optional number",
    },
    argsSchema: z.object({
      query: z.string().min(3).max(2000),
      limit: z.coerce.number().int().positive().max(10).default(5),
    }),
    run: async (args, context) => {
      const chunks = await ragService.retrieveGlobalContext(args.query, args.limit);

      if (chunks.length > 0) {
        return {
          query: args.query,
          matches: chunks,
          scope: "global",
        };
      }

      const terms = extractSearchTerms(args.query);
      if (terms.length === 0) {
        return {
          query: args.query,
          matches: [],
          scope: "global",
          fallbackUsed: "mongo_ai_records",
        };
      }

      // The fallback reads patient AI records, so it must respect patient assignments.
      const recordQuery: Record<string, unknown> = {
        deletedAt: { $exists: false },
      };

      const accessiblePatientIds = await getAccessiblePatientIds(context.actor);
      if (accessiblePatientIds) {
        if (accessiblePatientIds.length === 0) {
          return {
            query: args.query,
            matches: [],
            scope: "global",
            fallbackUsed: "mongo_ai_records",
          };
        }

        recordQuery.patientId = { $in: accessiblePatientIds };
      }

      const records = await AIRecordModel.find(recordQuery)
        .sort({ createdAt: -1 })
        .limit(100)
        .select("_id mode provider response contextChunks createdAt");

      const fallbackMatches = records
        .flatMap((record) => {
          const responseText = record.response?.trim() ?? "";
          const responseScore = scoreTextMatch(responseText, terms);

          const responseMatch =
            responseScore > 0
              ? [{
                  sourceId: `global:record:${record._id.toString()}:response`,
                  content: truncateResultContent(responseText),
                  score: responseScore,
                  sourceLabel: `mongo_global_record_${record.mode}`,
                  metadata: {
                    recordId: record._id.toString(),
                    provider: record.provider,
                    createdAt: record.createdAt?.toISOString?.(),
                    fallback: true,
                    sourceType: "record_response",
                  },
                }]
              : [];

          const chunkMatches = record.contextChunks
            .map((chunk, index) => {
              const chunkText = (chunk.content ?? "").trim();
              const chunkScore = scoreTextMatch(chunkText, terms);
              if (chunkScore <= 0) return null;
              return {
                sourceId: `global:record:${record._id.toString()}:chunk:${index}`,
                content: truncateResultContent(chunkText),
                score: chunkScore,
                sourceLabel: chunk.sourceLabel || `mongo_global_chunk_${record.mode}`,
                metadata: {
                  ...(chunk.metadata ?? {}),
                  recordId: record._id.toString(),
                  provider: record.provider,
                  createdAt: record.createdAt?.toISOString?.(),
                  fallback: true,
                  sourceType: "context_chunk",
                },
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          return [...responseMatch, ...chunkMatches];
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit);

      return {
        query: args.query,
        matches: fallbackMatches,
        scope: "global",
        fallbackUsed: "mongo_ai_records",
      };
    },
  }),
};
