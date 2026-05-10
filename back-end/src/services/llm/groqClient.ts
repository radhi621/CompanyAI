import Groq from "groq-sdk";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export const groqClient = {
  async generateText(prompt: string): Promise<string> {
    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are MediAssist IA, a professional medical-office AI assistant. Return detailed, thorough, and actionable outputs covering all relevant information.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new ApiError(502, "Groq returned an empty response");
    }

    return text;
  },
};