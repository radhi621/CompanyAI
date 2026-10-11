import { ApiError } from "../../utils/apiError";
import type { ChatToolCall, ChatTurn } from "./chatTypes";

/** Output token limit for chat answers; thinking tokens of Gemini 2.5 models count toward it. */
export const MAX_OUTPUT_TOKENS = 4096;

/** Low, so the same request gets the same tool calls and a similar answer each time. */
export const CHAT_TEMPERATURE = 0.3;

/** Thinking cap for Gemini 2.5 models, so thinking cannot use up the whole output limit. */
export const GEMINI_THINKING_BUDGET = 1024;

/**
 * Collapses runs of spaces inside a line. Models sometimes pad Markdown table cells to line
 * columns up; the chat renders tables itself, so the padding is noise. Leading indentation
 * (code blocks, nested lists) is kept.
 */
export function collapseSpacePadding(text: string): string {
  return text.replace(/(\S) {3,}/g, "$1 ");
}

/**
 * Validates a provider's answer. An answer that stopped at the token limit is incomplete
 * (often a table cut off mid-row), so it is rejected and the router tries the next provider.
 */
export function finalizeLlmText(input: {
  provider: "Gemini" | "Groq";
  text: string | null | undefined;
  stoppedAtTokenLimit: boolean;
}): string {
  if (input.stoppedAtTokenLimit) {
    throw new ApiError(502, `${input.provider} answer was cut off at the output token limit`);
  }

  const text = collapseSpacePadding(input.text ?? "").trim();
  if (!text) {
    throw new ApiError(502, `${input.provider} returned an empty response`);
  }

  return text;
}

/**
 * Validates one turn of a tool-calling conversation. A turn must call tools or answer; an
 * empty turn or one cut off at the token limit is rejected so the router retries.
 */
export function finalizeChatTurn(input: {
  provider: "Gemini" | "Groq";
  text: string | null | undefined;
  toolCalls: ChatToolCall[];
  stoppedAtTokenLimit: boolean;
}): ChatTurn {
  if (input.stoppedAtTokenLimit && input.toolCalls.length === 0) {
    throw new ApiError(502, `${input.provider} answer was cut off at the output token limit`);
  }

  const text = collapseSpacePadding(input.text ?? "").trim();
  if (!text && input.toolCalls.length === 0) {
    throw new ApiError(502, `${input.provider} returned an empty response`);
  }

  return { text: text || null, toolCalls: input.toolCalls };
}
