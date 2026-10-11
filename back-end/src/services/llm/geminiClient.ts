import { type Content, GoogleGenAI, type Part } from "@google/genai";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import type { ChatMessage, ChatRequest, ChatTurn } from "./chatTypes";
import {
  CHAT_TEMPERATURE,
  GEMINI_THINKING_BUDGET,
  MAX_OUTPUT_TOKENS,
  finalizeChatTurn,
  finalizeLlmText,
} from "./llmOutput";

const gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const lines = [error.message];
    const apiErr = error as { error?: Record<string, unknown> };
    if (apiErr.error) {
      lines.push(JSON.stringify(apiErr.error));
    }
    return lines.join(" | ");
  }

  return String(error);
}

export const geminiClient = {
  async generateText(prompt: string): Promise<string> {
    let response: Awaited<ReturnType<typeof gemini.models.generateContent>>;

    try {
      response = await gemini.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.7,
          // Only 2.5 models take a thinking budget; older models reject the setting.
          ...(/gemini-2\.5/.test(env.GEMINI_MODEL)
            ? { thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET } }
            : {}),
        },
      });
    } catch (error) {
      throw new ApiError(502, `Gemini generation failed: ${errorMessage(error)}`, {
        model: env.GEMINI_MODEL,
      });
    }

    return finalizeLlmText({
      provider: "Gemini",
      text: response.text,
      stoppedAtTokenLimit: response.candidates?.[0]?.finishReason === "MAX_TOKENS",
    });
  },

  /** One turn of a tool-calling conversation. */
  async chat(request: ChatRequest): Promise<ChatTurn> {
    let response: Awaited<ReturnType<typeof gemini.models.generateContent>>;

    try {
      response = await gemini.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: toGeminiContents(request.messages),
        config: {
          systemInstruction: request.system,
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
              })),
            },
          ],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: CHAT_TEMPERATURE,
          ...(/gemini-2\.5/.test(env.GEMINI_MODEL)
            ? { thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET } }
            : {}),
        },
      });
    } catch (error) {
      throw new ApiError(502, `Gemini generation failed: ${errorMessage(error)}`, {
        model: env.GEMINI_MODEL,
      });
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return finalizeChatTurn({
      provider: "Gemini",
      text: parts
        .filter((part) => typeof part.text === "string" && !part.thought)
        .map((part) => part.text)
        .join(""),
      toolCalls: parts.flatMap((part, index) =>
        part.functionCall?.name
          ? [
              {
                id: part.functionCall.id ?? `gemini-${Date.now().toString(36)}-${index}`,
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                signature: part.thoughtSignature,
              },
            ]
          : [],
      ),
      stoppedAtTokenLimit: response.candidates?.[0]?.finishReason === "MAX_TOKENS",
    });
  },

  async embedText(text: string): Promise<number[]> {
    let response: Awaited<ReturnType<typeof gemini.models.embedContent>>;

    try {
      response = await gemini.models.embedContent({
        model: env.GEMINI_EMBEDDING_MODEL,
        contents: [text],
        config: {
          outputDimensionality: env.QDRANT_VECTOR_SIZE,
        },
      });
    } catch (error) {
      throw new ApiError(502, `Gemini embedding failed: ${errorMessage(error)}`, {
        model: env.GEMINI_EMBEDDING_MODEL,
      });
    }

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding || embedding.length === 0) {
      throw new ApiError(502, "Gemini embedding response is empty");
    }

    return embedding;
  },
};

/**
 * Neutral messages → Gemini contents. Gemini expects user and model turns to alternate, so
 * consecutive messages of the same side are merged (for example the results of one turn's
 * tool calls, or a confirmation request followed by its outcome).
 */
function toGeminiContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];

  const add = (role: "user" | "model", parts: Part[]) => {
    if (parts.length === 0) {
      return;
    }
    const previous = contents.at(-1);
    if (previous?.role === role) {
      previous.parts = [...(previous.parts ?? []), ...parts];
    } else {
      contents.push({ role, parts });
    }
  };

  for (const message of messages) {
    if (message.role === "user") {
      add("user", [{ text: message.text }]);
    } else if (message.role === "assistant") {
      add("model", [
        ...(message.text ? [{ text: message.text }] : []),
        ...(message.toolCalls ?? []).map((call) => ({
          functionCall: { id: call.id, name: call.name, args: call.args },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        })),
      ]);
    } else {
      add("user", [
        { functionResponse: { id: message.callId, name: message.name, response: { result: message.result } } },
      ]);
    }
  }

  return contents;
}
