import { Schema, Types, model, type Document } from "mongoose";
import type { UserRole } from "../types/auth";
import type { AgentToolName } from "./AgentPendingAction";

export interface IAgentAuditToolResult {
  tool: AgentToolName;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface IAgentAuditLogDocument extends Document {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  actorRole: UserRole;
  prompt: string;
  plannerResponse: string;
  toolResults: IAgentAuditToolResult[];
  pendingActionId?: Types.ObjectId;
  requiresConfirmation: boolean;
  success: boolean;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const agentAuditToolResultSchema = new Schema<IAgentAuditToolResult>(
  {
    tool: {
      type: String,
      required: true,
    },
    args: {
      type: Schema.Types.Mixed,
      default: {},
    },
    result: {
      type: Schema.Types.Mixed,
    },
    error: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

const agentAuditLogSchema = new Schema<IAgentAuditLogDocument>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["admin", "doctor", "nurse", "secretary"],
      required: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    plannerResponse: {
      type: String,
      required: true,
    },
    toolResults: {
      type: [agentAuditToolResultSchema],
      default: [],
    },
    pendingActionId: {
      type: Schema.Types.ObjectId,
      ref: "AgentPendingAction",
    },
    requiresConfirmation: {
      type: Boolean,
      default: false,
    },
    success: {
      type: Boolean,
      required: true,
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

agentAuditLogSchema.index({ createdAt: -1 });

export const AgentAuditLogModel = model<IAgentAuditLogDocument>("AgentAuditLog", agentAuditLogSchema);