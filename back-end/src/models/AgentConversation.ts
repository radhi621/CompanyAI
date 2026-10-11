import { Schema, Types, model, type Document } from "mongoose";
import type { ChatMessage } from "../services/llm/chatTypes";

// The assistant's memory of one chat session: every message, including the tool calls it made
// and what they returned, so follow-ups ("done?", "delete the second one") have the context.

/** Conversations are kept this long after their last message. */
export const CONVERSATION_TTL_DAYS = 30;

export interface IAgentConversationDocument extends Document {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  /** The frontend's chat session ID. */
  conversationId: string;
  patientId?: Types.ObjectId;
  messages: ChatMessage[];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const agentConversationSchema = new Schema<IAgentConversationDocument>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: String, required: true, trim: true, maxlength: 120 },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
    // Mixed: whole-array writes only (assign, then markModified), never in-place pushes.
    messages: { type: Schema.Types.Mixed, default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One conversation per user and chat session; nobody else can read or continue it.
agentConversationSchema.index({ actorId: 1, conversationId: 1 }, { unique: true });
agentConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AgentConversationModel = model<IAgentConversationDocument>(
  "AgentConversation",
  agentConversationSchema,
);
