// Provider-neutral chat with tool calling. Conversations are stored in this shape, so any
// provider can continue a conversation another one started (Gemini → Groq fallback).

export interface ChatToolCall {
  /** Unique within the conversation; links the call to its result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini's thought signature for this call, sent back to Gemini on the next turn. */
  signature?: string;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ChatToolCall[] }
  | { role: "tool"; callId: string; name: string; result: unknown };

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ChatTool[];
}

/** One model turn: either tool calls to run, or the answer (text), or both. */
export interface ChatTurn {
  text: string | null;
  toolCalls: ChatToolCall[];
}
