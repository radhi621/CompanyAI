import { Schema, Types, model, type Document } from "mongoose";

export type AgentIdempotencyScope = "agent_execute" | "agent_confirm";
export type AgentIdempotencyStatus = "processing" | "completed" | "failed";

export interface IAgentIdempotencyDocument extends Document {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  scope: AgentIdempotencyScope;
  key: string;
  requestHash: string;
  status: AgentIdempotencyStatus;
  responsePayload?: unknown;
  errorMessage?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const agentIdempotencySchema = new Schema<IAgentIdempotencyDocument>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: ["agent_execute", "agent_confirm"],
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      required: true,
      default: "processing",
      index: true,
    },
    responsePayload: {
      type: Schema.Types.Mixed,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

agentIdempotencySchema.index({ actorId: 1, scope: 1, key: 1 }, { unique: true });
agentIdempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AgentIdempotencyModel = model<IAgentIdempotencyDocument>(
  "AgentIdempotency",
  agentIdempotencySchema,
);