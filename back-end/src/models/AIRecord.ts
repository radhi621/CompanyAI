import { Schema, Types, model, type Document } from "mongoose";
import type { UserRole } from "../types/auth";

export type AIRecordMode = "non_rag" | "rag";
export type AIProvider = "gemini" | "groq";

export interface IAIContextChunk {
  sourceId: string;
  content: string;
  score: number;
  sourceLabel: string;
  metadata?: Record<string, unknown>;
}

export interface IAISourceFile {
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount?: number;
}

export interface IAIRecordDocument extends Document {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  title?: string;
  prompt: string;
  response: string;
  mode: AIRecordMode;
  provider: AIProvider;
  contextChunks: IAIContextChunk[];
  sourceFiles: IAISourceFile[];
  createdBy: Types.ObjectId;
  createdByRole: UserRole;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  permissions: {
    ownerOnlyEdit: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const aiContextChunkSchema = new Schema<IAIContextChunk>(
  {
    sourceId: { type: String, required: true },
    content: { type: String, required: true },
    score: { type: Number, required: true },
    sourceLabel: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const aiSourceFileSchema = new Schema<IAISourceFile>(
  {
    fileName: { type: String, required: true },
    extension: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    chunkCount: { type: Number },
  },
  { _id: false },
);

const aiRecordSchema = new Schema<IAIRecordDocument>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    response: {
      type: String,
      required: true,
    },
    mode: {
      type: String,
      enum: ["non_rag", "rag"],
      required: true,
    },
    provider: {
      type: String,
      enum: ["gemini", "groq"],
      required: true,
    },
    contextChunks: [aiContextChunkSchema],
    sourceFiles: {
      type: [aiSourceFileSchema],
      default: [],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdByRole: {
      type: String,
      enum: ["admin", "doctor", "nurse", "secretary"],
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    deletedAt: {
      type: Date,
      index: true,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    permissions: {
      ownerOnlyEdit: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
  },
);

aiRecordSchema.index({ patientId: 1, createdAt: -1, deletedAt: 1 });

export const AIRecordModel = model<IAIRecordDocument>("AIRecord", aiRecordSchema);