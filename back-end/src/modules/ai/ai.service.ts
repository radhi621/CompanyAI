import { Types } from "mongoose";
import {
  AIRecordModel,
  type AIRecordMode,
  type IAISourceFile,
  type IAIRecordDocument,
} from "../../models/AIRecord";
import { PatientModel } from "../../models/Patient";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { llmRouter } from "../../services/llm/llmRouter";
import { formatRagContext, ragService } from "../../services/rag/ragService";
import {
  parseUploadedDocuments,
  type ParsedDocument,
} from "../../services/files/documentParser";

interface GenerateAIRecordInput {
  actor: AuthUser;
  patientId: string;
  title?: string;
  prompt: string;
  mode: AIRecordMode;
}

interface UploadAIRecordFromFilesInput {
  actor: AuthUser;
  patientId: string;
  title?: string;
  prompt?: string;
  mode: AIRecordMode;
  files: Express.Multer.File[];
}

interface UploadGlobalKnowledgeInput {
  actor: AuthUser;
  files: Express.Multer.File[];
  note?: string;
}

interface ListAIRecordsInput {
  actor: AuthUser;
  patientId?: string;
  mode?: AIRecordMode;
  includeDeleted?: boolean;
  limit: number;
}

interface UpdateAIRecordInput {
  actor: AuthUser;
  record: IAIRecordDocument;
  title?: string;
  response?: string;
}

const DEFAULT_FILE_ANALYSIS_PROMPT =
  "Summarize the uploaded patient documents and provide concise actionable clinical and operational insights.";
const MAX_FILE_CONTEXT_PER_DOC = 12_000;
const MAX_FILE_CHUNKS_FOR_RECORD = 8;
const MAX_CHUNK_CONTENT_FOR_RECORD = 1200;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function assertPatientAccess(patientId: string, actor: AuthUser): Promise<void> {
  const patient = await PatientModel.findById(patientId).select("assignedStaff");
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }

  if (actor.role === "admin") {
    return;
  }

  const isAssigned = patient.assignedStaff.some((staffId) => staffId.toString() === actor.id);
  if (!isAssigned) {
    throw new ApiError(403, "You are not assigned to this patient");
  }
}

function buildMedicalAssistantPrompt(actor: AuthUser, prompt: string, ragContext: string): string {
  return [
    "You are MediAssist IA for a professional medical department.",
    "Return detailed, accurate, role-aware operational responses for clinical office workflows. Provide thorough explanations covering all relevant details.",
    `Requester role: ${actor.role}`,
    "If the prompt asks for insertion/update guidance, provide structured data-focused output suitable for system storage.",
    `RAG Context:\n${ragContext}`,
    `User Prompt:\n${prompt}`,
  ].join("\n\n");
}

function buildUploadedDocumentsContext(documents: ParsedDocument[]): string {
  return documents
    .map((doc, index) => {
      return [
        `Document ${index + 1}: ${doc.fileName}`,
        `Type: ${doc.extension} | Size: ${doc.sizeBytes} bytes`,
        truncateText(doc.text, MAX_FILE_CONTEXT_PER_DOC),
      ].join("\n");
    })
    .join("\n\n");
}

function buildRecordSourceFiles(documents: ParsedDocument[]): IAISourceFile[] {
  return documents.map((doc) => ({
    fileName: doc.fileName,
    extension: doc.extension,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  }));
}

function buildUploadedContextChunks(documents: ParsedDocument[]) {
  return documents.slice(0, MAX_FILE_CHUNKS_FOR_RECORD).map((doc, index) => ({
    sourceId: `uploaded_file_${index + 1}`,
    content: truncateText(doc.text, MAX_CHUNK_CONTENT_FOR_RECORD),
    score: 1,
    sourceLabel: `uploaded_file_${doc.extension.replace(/^\./, "")}`,
    metadata: {
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
    },
  }));
}

export const aiService = {
  async generateRecordFromPrompt(input: GenerateAIRecordInput): Promise<IAIRecordDocument> {
    await assertPatientAccess(input.patientId, input.actor);

    const contextChunks =
      input.mode === "rag" ? await ragService.retrieveContext(input.patientId, input.prompt) : [];

    const finalPrompt = buildMedicalAssistantPrompt(
      input.actor,
      input.prompt,
      formatRagContext(contextChunks),
    );

    const llmResult = await llmRouter.generate(finalPrompt);

    const record = await AIRecordModel.create({
      patientId: new Types.ObjectId(input.patientId),
      title: input.title,
      prompt: input.prompt,
      response: llmResult.text,
      mode: input.mode,
      provider: llmResult.provider,
      contextChunks,
      createdBy: new Types.ObjectId(input.actor.id),
      createdByRole: input.actor.role,
      permissions: {
        ownerOnlyEdit: true,
      },
    });

    try {
      await ragService.indexRecord(record);
    } catch (error) {
      console.error(`Failed to index record ${record._id} into Qdrant:`, error instanceof Error ? error.message : String(error));
    }

    return record;
  },

  async generateRecordFromFiles(input: UploadAIRecordFromFilesInput): Promise<IAIRecordDocument> {
    await assertPatientAccess(input.patientId, input.actor);

    const documents = await parseUploadedDocuments(input.files);
    const effectivePrompt = input.prompt?.trim() || DEFAULT_FILE_ANALYSIS_PROMPT;

    const ragContextChunks =
      input.mode === "rag" ? await ragService.retrieveContext(input.patientId, effectivePrompt) : [];

    const uploadedDocumentsContext = buildUploadedDocumentsContext(documents);

    const fileAwarePrompt = [
      effectivePrompt,
      "Uploaded Documents Context:",
      uploadedDocumentsContext,
    ].join("\n\n");

    const finalPrompt = buildMedicalAssistantPrompt(
      input.actor,
      fileAwarePrompt,
      formatRagContext(ragContextChunks),
    );

    const llmResult = await llmRouter.generate(finalPrompt);

    const record = await AIRecordModel.create({
      patientId: new Types.ObjectId(input.patientId),
      title: input.title,
      prompt: effectivePrompt,
      response: llmResult.text,
      mode: input.mode,
      provider: llmResult.provider,
      contextChunks: [...ragContextChunks, ...buildUploadedContextChunks(documents)],
      sourceFiles: buildRecordSourceFiles(documents),
      createdBy: new Types.ObjectId(input.actor.id),
      createdByRole: input.actor.role,
      permissions: {
        ownerOnlyEdit: true,
      },
    });

    try {
      await ragService.indexRecord(record);
    } catch (error) {
      console.error(`Failed to index record ${record._id} into Qdrant:`, error instanceof Error ? error.message : String(error));
    }

    if (input.mode === "rag") {
      try {
        const chunkStats = await ragService.indexUploadedFileChunks({ record, documents });
        if (chunkStats.length > 0) {
          record.sourceFiles = record.sourceFiles.map((sourceFile) => {
            const matching = chunkStats.find((item) => item.fileName === sourceFile.fileName);
            if (!matching) {
              return sourceFile;
            }
            return { ...sourceFile, chunkCount: matching.chunkCount };
          });
          await record.save();
        }
      } catch (error) {
        console.error(`Failed to index uploaded file chunks for record ${record._id}:`, error instanceof Error ? error.message : String(error));
      }
    }

    return record;
  },

  async uploadGlobalKnowledgeFromFiles(input: UploadGlobalKnowledgeInput): Promise<{
    note?: string;
    totalFiles: number;
    totalChunks: number;
    fileStats: Array<{ fileName: string; chunkCount: number }>;
  }> {
    if (input.actor.role !== "admin") {
      throw new ApiError(403, "Only admin can upload global knowledge files");
    }

    const documents = await parseUploadedDocuments(input.files);
    const chunkStats = await ragService.indexGlobalDocuments({
      documents,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    const totalChunks = chunkStats.reduce((sum, item) => sum + item.chunkCount, 0);

    return {
      note: input.note,
      totalFiles: documents.length,
      totalChunks,
      fileStats: chunkStats,
    };
  },

  async listRecords(input: ListAIRecordsInput): Promise<IAIRecordDocument[]> {
    const query: Record<string, unknown> = {};

    if (input.mode) {
      query.mode = input.mode;
    }

    if (input.includeDeleted) {
      if (input.actor.role !== "admin") {
        throw new ApiError(403, "Only admin can include deleted records");
      }
    } else {
      query.deletedAt = { $exists: false };
    }

    if (input.patientId) {
      await assertPatientAccess(input.patientId, input.actor);
      query.patientId = new Types.ObjectId(input.patientId);
    } else if (input.actor.role !== "admin") {
      const assignedPatients = await PatientModel.find({
        assignedStaff: new Types.ObjectId(input.actor.id),
      }).select("_id");

      const assignedIds = assignedPatients.map((patient) => patient._id);
      if (assignedIds.length === 0) {
        return [];
      }

      query.patientId = {
        $in: assignedIds,
      };
    }

    return AIRecordModel.find(query)
      .sort({ createdAt: -1 })
      .limit(input.limit)
      .populate("createdBy", "name email role");
  },

  async getRecordById(recordId: string, actor: AuthUser): Promise<IAIRecordDocument> {
    const record = await AIRecordModel.findOne({
      _id: recordId,
      deletedAt: { $exists: false },
    }).populate("createdBy", "name email role");
    if (!record) {
      throw new ApiError(404, "AI record not found");
    }

    await assertPatientAccess(record.patientId.toString(), actor);
    return record;
  },

  async updateRecord(input: UpdateAIRecordInput): Promise<IAIRecordDocument> {
    const { record, title, response, actor } = input;

    if (title !== undefined) {
      record.title = title;
    }

    if (response !== undefined) {
      record.response = response;
    }

    record.updatedBy = new Types.ObjectId(actor.id);
    await record.save();

    if (response !== undefined) {
      try {
        await ragService.indexRecord(record);
      } catch (error) {
        console.error(`Failed to re-index record ${record._id} after update:`, error instanceof Error ? error.message : String(error));
      }
    }

    return record;
  },

  async deleteRecord(record: IAIRecordDocument, actor: AuthUser): Promise<void> {
    record.deletedAt = new Date();
    record.deletedBy = new Types.ObjectId(actor.id);
    record.updatedBy = new Types.ObjectId(actor.id);
    await record.save();
    try {
      await ragService.deleteRecordVector(record._id.toString());
    } catch (error) {
      console.error(`Failed to delete Qdrant vectors for record ${record._id}:`, error instanceof Error ? error.message : String(error));
    }
  },

  async restoreRecord(recordId: string, actor: AuthUser): Promise<IAIRecordDocument> {
    if (actor.role !== "admin") {
      throw new ApiError(403, "Only admin can restore deleted AI records");
    }

    const record = await AIRecordModel.findById(recordId);
    if (!record || !record.deletedAt) {
      throw new ApiError(404, "Deleted AI record not found");
    }

    record.deletedAt = undefined;
    record.deletedBy = undefined;
    record.updatedBy = new Types.ObjectId(actor.id);
    await record.save();

    try {
      await ragService.indexRecord(record);
    } catch (error) {
      console.error(`Failed to re-index restored record ${record._id}:`, error instanceof Error ? error.message : String(error));
    }

    return record;
  },
};