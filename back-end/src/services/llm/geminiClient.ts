import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { GEMINI_THINKING_BUDGET, MAX_OUTPUT_TOKENS, finalizeLlmText } from "./llmOutput";

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