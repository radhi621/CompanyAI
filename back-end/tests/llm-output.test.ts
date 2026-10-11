import { describe, expect, it } from "vitest";
import { collapseSpacePadding, finalizeLlmText } from "../src/services/llm/llmOutput";

describe("LLM answer checks", () => {
  it("rejects an answer cut off at the token limit, so the router tries the next provider", () => {
    // What Gemini returned in the bug: a table that stops mid-row.
    const cutOff = "Total notes: 6\n\n| Date | Author | Note | ID |\n|---|---|---|---|\n| 2026-10-09 | AI | Summary | `6ac8da71";

    expect(() => finalizeLlmText({ provider: "Gemini", text: cutOff, stoppedAtTokenLimit: true })).toThrow(
      "Gemini answer was cut off at the output token limit",
    );
  });

  it("rejects an empty answer", () => {
    expect(() => finalizeLlmText({ provider: "Groq", text: "   ", stoppedAtTokenLimit: false })).toThrow(
      "Groq returned an empty response",
    );
  });

  it("removes table padding but keeps the table and indentation", () => {
    const padded = [
      "| Date       | Author          | ID |",
      "|------------|-----------------|----|",
      "| 2026-10-09 | Dr Amrani       | `6ac8da7138ffdef5150687c6` |",
      "    const indented = true;",
    ].join("\n");

    expect(collapseSpacePadding(padded)).toBe(
      [
        "| Date | Author | ID |",
        "|------------|-----------------|----|",
        "| 2026-10-09 | Dr Amrani | `6ac8da7138ffdef5150687c6` |",
        "    const indented = true;",
      ].join("\n"),
    );
  });

  it("returns a complete answer trimmed", () => {
    expect(finalizeLlmText({ provider: "Gemini", text: "\n**2 patients** found.\n", stoppedAtTokenLimit: false })).toBe(
      "**2 patients** found.",
    );
  });
});
