import Groq from "groq-sdk";
import { env } from "../../config/env";
import { MAX_OUTPUT_TOKENS, finalizeLlmText } from "./llmOutput";

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
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.7,
    });

    const choice = completion.choices[0];
    return finalizeLlmText({
      provider: "Groq",
      text: choice?.message?.content,
      stoppedAtTokenLimit: choice?.finish_reason === "length",
    });
  },
};