import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import type { ChatMessage, ChatRequest, ChatToolCall, ChatTurn } from "./chatTypes";
import { CHAT_TEMPERATURE, MAX_OUTPUT_TOKENS, finalizeChatTurn, finalizeLlmText } from "./llmOutput";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

// gpt-oss models reason before answering, and that counts toward max_tokens.
const reasoningOptions = () =>
  env.GROQ_MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {};

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
      ...reasoningOptions(),
    });

    const choice = completion.choices[0];
    return finalizeLlmText({
      provider: "Groq",
      text: choice?.message?.content,
      stoppedAtTokenLimit: choice?.finish_reason === "length",
    });
  },

  /** One turn of a tool-calling conversation. */
  async chat(request: ChatRequest): Promise<ChatTurn> {
    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [{ role: "system", content: request.system }, ...toGroqMessages(request.messages)],
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: "auto",
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: CHAT_TEMPERATURE,
      ...reasoningOptions(),
    });

    const choice = completion.choices[0];
    const toolCalls: ChatToolCall[] = (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      args: parseArguments(call.function.name, call.function.arguments),
    }));

    return finalizeChatTurn({
      provider: "Groq",
      text: choice?.message?.content,
      toolCalls,
      stoppedAtTokenLimit: choice?.finish_reason === "length",
    });
  },
};

function parseArguments(tool: string, raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  throw new ApiError(502, `Groq returned invalid arguments for ${tool}`);
}

function toGroqMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role === "user") {
      return { role: "user", content: message.text };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.text ?? "",
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      };
    }
    return { role: "tool", tool_call_id: message.callId, content: JSON.stringify(message.result ?? null) };
  });
}
