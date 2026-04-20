import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";

const gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
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
      });
    } catch (error) {
      throw new ApiError(502, `Gemini generation failed: ${errorMessage(error)}`, {
        model: env.GEMINI_MODEL,
      });
    }

    const text = response.text?.trim();
    if (!text) {
      throw new ApiError(502, "Gemini returned an empty response");
    }

    return text;
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