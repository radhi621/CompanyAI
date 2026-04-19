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
            "You are MediAssist IA, a professional medical-office AI assistant. Return concise, accurate, and actionable outputs.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new ApiError(502, "Groq returned an empty response");
    }

    return text;
  },
};