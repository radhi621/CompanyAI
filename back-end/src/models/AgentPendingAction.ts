import { Schema, Types, model, type Document } from "mongoose";
import type { UserRole } from "../types/auth";

export const AGENT_TOOL_NAMES = [
  "search_patient",
  "get_patient_summary",
  "list_appointments",
  "check_availability",
  "create_appointment",
  "cancel_appointment",
  "get_uncontacted_patients",
  "search_medical_records_RAG",
  "update_patient_notes",
  "get_day_schedule",
  "create_staff_account",
  "create_doctor_profile",
  "list_doctors",
] as const;

export type AgentToolName =
  | "search_patient"
  | "get_patient_summary"
  | "list_appointments"
  | "check_availability"
  | "create_appointment"
  | "cancel_appointment"
  | "get_uncontacted_patients"
  | "search_medical_records_RAG"
  | "update_patient_notes"
  | "get_day_schedule"
  | "create_staff_account"
  | "create_doctor_profile"
  | "list_doctors";

export interface IAgentToolCall {
  tool: AgentToolName;
  args: Record<string, unknown>;
  reason?: string;
}

export interface IAgentPendingActionDocument extends Document {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  actorRole: UserRole;
  prompt: string;
  toolCalls: IAgentToolCall[];
  status: "pending" | "approved" | "executed" | "rejected";
  expiresAt: Date;
  approvedAt?: Date;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const agentToolCallSchema = new Schema<IAgentToolCall>(
  {
    tool: {
      type: String,
      enum: AGENT_TOOL_NAMES,
      required: true,
    },
    args: {
      type: Schema.Types.Mixed,
      default: {},
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

const agentPendingActionSchema = new Schema<IAgentPendingActionDocument>(
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
    toolCalls: {
      type: [agentToolCallSchema],
      required: true,
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "executed", "rejected"],
      required: true,
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    approvedAt: {
      type: Date,
    },
    executedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

agentPendingActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AgentPendingActionModel = model<IAgentPendingActionDocument>(
  "AgentPendingAction",
  agentPendingActionSchema,
);