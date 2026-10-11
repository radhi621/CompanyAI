import { describe, expect, it, vi } from "vitest";
import { geminiClient } from "../src/services/llm/geminiClient";
import { groqClient } from "../src/services/llm/groqClient";
import { llmRouter } from "../src/services/llm/llmRouter";

vi.mock("../src/services/llm/geminiClient", () => ({ geminiClient: { generateText: vi.fn() } }));
vi.mock("../src/services/llm/groqClient", () => ({ groqClient: { generateText: vi.fn() } }));

const QUOTA_ERROR = new Error('Gemini generation failed: {"code":429,"retryDelay":"81941s"}');

describe("llmRouter", () => {
  it("passes JSON mode to the provider", async () => {
    vi.mocked(geminiClient.generateText).mockResolvedValue('{"toolCalls":[]}');

    await llmRouter.generate("plan", { json: true, retriesPerProvider: 1 });

    expect(geminiClient.generateText).toHaveBeenCalledWith("plan", { json: true });
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
