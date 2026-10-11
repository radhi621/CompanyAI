import { describe, expect, it, vi } from "vitest";
import { geminiClient } from "../src/services/llm/geminiClient";
import { groqClient } from "../src/services/llm/groqClient";
import { llmRouter } from "../src/services/llm/llmRouter";

vi.mock("../src/services/llm/geminiClient", () => ({ geminiClient: { generateText: vi.fn(), chat: vi.fn() } }));
vi.mock("../src/services/llm/groqClient", () => ({ groqClient: { generateText: vi.fn(), chat: vi.fn() } }));

const QUOTA_ERROR = new Error('Gemini generation failed: {"code":429,"retryDelay":"81941s"}');

describe("llmRouter", () => {
  it("falls back to the next provider for a chat turn", async () => {
    const request = { system: "s", messages: [{ role: "user" as const, text: "hi" }], tools: [] };
    vi.mocked(geminiClient.chat).mockRejectedValue(QUOTA_ERROR);
    vi.mocked(groqClient.chat).mockResolvedValue({ text: "Hello.", toolCalls: [] });

    const reply = await llmRouter.chat(request, { retriesPerProvider: 2, retryBaseDelayMs: 50 });

    expect(reply).toEqual({ provider: "groq", turn: { text: "Hello.", toolCalls: [] } });
    // A daily quota is not retried: one Gemini attempt, then Groq.
    expect(geminiClient.chat).toHaveBeenCalledTimes(1);
  });

  it("does not blame rate limits when another provider failed for a different reason", async () => {
    vi.mocked(geminiClient.generateText).mockRejectedValue(QUOTA_ERROR);
    vi.mocked(groqClient.generateText).mockRejectedValue(new Error("Groq returned an empty response"));

    await expect(llmRouter.generate("plan", { retriesPerProvider: 1, retryBaseDelayMs: 50 })).rejects.toThrow(
      "All LLM providers failed (gemini: rate limited; groq: Groq returned an empty response)",
    );
  });

  it("reports the wait when every provider is rate limited", async () => {
    vi.mocked(geminiClient.generateText).mockRejectedValue(QUOTA_ERROR);
    vi.mocked(groqClient.generateText).mockRejectedValue(new Error("Rate limit reached. Please try again in 12.5s"));

    await expect(llmRouter.generate("plan", { retriesPerProvider: 1, retryBaseDelayMs: 50 })).rejects.toThrow(
      "All LLM providers are rate limited. Try again in 1366 minute(s).",
    );
  });
});
