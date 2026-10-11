// Prompts sent to the AI providers: planner, planner repair, no-tool fallback and answer writer.
import type { AuthUser } from "../../types/auth";
import { getToolCatalogForPrompt } from "./agent.tools";
import type { ConversationTurn, ExecutedToolResult } from "./agent.types";

function formatConversationHistory(history?: ConversationTurn[]): string {
  if (!history || history.length === 0) return "";
  const lines = history
    .filter((h) => h.role !== "system")
    .map((h) => {
      const label = h.role === "user" ? "User" : "Assistant";
      return `${label}: ${h.text}`;
    });
  if (lines.length === 0) return "";
  return ["Previous conversation:", ...lines, "--- Current request ---"].join("\n\n");
}

export function buildPlannerPrompt(actor: AuthUser, prompt: string, maxToolCalls: number, history?: ConversationTurn[]): string {
  const toolCatalog = JSON.stringify(getToolCatalogForPrompt(), null, 2);
  const historyBlock = formatConversationHistory(history);

  const parts = [
    "You are an orchestration planner for MediAssist IA.",
    `Requester role: ${actor.role}`,
    "Plan tool calls using only allowed tools for the request.",
    "Interpret user intent semantically; do not rely on rigid keyword shortcuts or canned question templates.",
    "For informational questions about patient state/history/findings, prefer retrieval tools when patient context can be resolved.",
    `Limit planned tool calls to at most ${maxToolCalls}.`,
    "Return only a JSON object with this exact shape:",
    '{"thought":"optional","toolCalls":[{"tool":"...","args":{},"reason":"optional"}],"finalMessage":"optional"}',
    // The answer the user reads is written later from the tool results, so a finalMessage written
    // before any data exists is only used when no tools are needed.
    "Leave finalMessage out when you plan tool calls. When no tools are needed, finalMessage is the complete answer to the user, in Markdown.",
    "Do not wrap JSON in markdown.",
    "Never use symbolic placeholders in args (for example: @search_patient.output.patientId, <PATIENT_ID>, <DOCTOR_ID>).",
    "If an ID is unknown, plan only the discovery call first (for example search_patient) and let the system continue.",
    "Available tools:",
    toolCatalog,
  ];

  if (historyBlock) {
    parts.push(historyBlock);
  }

  parts.push("User request:", prompt);

  return parts.join("\n\n");
}

export function buildPlannerRepairPrompt(
  actor: AuthUser,
  prompt: string,
  maxToolCalls: number,
  invalidOutput: string,
  parseErrorMessage: string,
  history?: ConversationTurn[],
): string {
  const toolCatalog = JSON.stringify(getToolCatalogForPrompt(), null, 2);
  const historyBlock = formatConversationHistory(history);

  const parts = [
    "You are repairing a malformed planner output.",
    `Requester role: ${actor.role}`,
    `Original request: ${prompt}`,
    `Max allowed tool calls: ${maxToolCalls}`,
    "Fix the output and return only valid JSON with exact shape:",
    '{"thought":"optional","toolCalls":[{"tool":"...","args":{},"reason":"optional"}],"finalMessage":"optional"}',
    "Do not use markdown fences.",
    "Never use symbolic placeholders in args (for example: @search_patient.output.patientId, <PATIENT_ID>, <DOCTOR_ID>).",
    `Previous parse issue: ${parseErrorMessage}`,
    "Allowed tool catalog:",
    toolCatalog,
  ];

  if (historyBlock) {
    parts.push(historyBlock);
  }

  parts.push("Invalid output to repair:", invalidOutput);

  return parts.join("\n\n");
}

export function buildNoToolFallbackPrompt(actor: AuthUser, prompt: string, history?: ConversationTurn[]): string {
  const historyBlock = formatConversationHistory(history);

  const parts = [
    "You are MediAssist IA.",
    `Requester role: ${actor.role}`,
    "Provide a detailed, thorough, and safe response without performing any database-modifying action.",
    "If evidence is insufficient, clearly say what patient context is missing and ask for one clarifying detail.",
    "Do not imply that actions were executed.",
    "Respond in plain text only.",
  ];

  if (historyBlock) {
    parts.push(historyBlock);
  }

  parts.push("User request:", prompt);

  return parts.join("\n\n");
}

export function buildSynthesisPrompt(actor: AuthUser, prompt: string, results: ExecutedToolResult[], history?: ConversationTurn[]): string {
  const resultsJson = JSON.stringify(
    results.map((r) => ({
      tool: r.tool,
      args: r.args,
      result: r.result,
    })),
    null,
    2,
  );
  const historyBlock = formatConversationHistory(history);

  const parts = [
    "You are MediAssist IA, a professional medical-office AI assistant generating the final response to the user.",
    `Requester role: ${actor.role}`,
    "Write a precise, concise summary focused only on the data returned. Present facts directly — no introductions, no conclusions, no fluff.",
    "Do not explain what you did or how you searched. Just state the results.",
    "Format the answer in Markdown; the chat renders bold text, lists and tables.",
    [
      "When the results contain two or more records (patients, appointments, notes, doctors, users),",
      "present them as a Markdown table: one row per record, human-readable columns first",
      "(patients: Name, CIN, Date of birth, Phone, Pathologies; appointments: Date, Time, Patient, Doctor, Reason, Status;",
      "notes: Date, Author, Note; doctors: Name, Specialty, Active),",
      "and the record's full ID as the last column, written in backticks (e.g. `6ac7f8e295fc5deac8262ee7`).",
      "Never shorten IDs: follow-up requests rely on them.",
    ].join(" "),
    [
      "Write tables compactly: exactly one space on each side of every cell, never pad cells with extra spaces",
      "to line columns up, and keep the separator row as | --- | --- |.",
      "Example row: | 2026-10-09 | Dr Youssef Amrani | Follow-up in 3 months | `6ac7f8e295fc5deac8262ee7` |",
    ].join(" "),
    "Use a dash (—) for missing values, dates as YYYY-MM-DD, and keep cell text short.",
    "A single record can be shown as a short bold-labelled list instead of a table.",
    "Start with a one-line count or summary (e.g. 'Total patients: 5'), then the table.",
    "If nothing was found, say so in one sentence.",
  ];

  if (historyBlock) {
    parts.push(historyBlock);
  }

  parts.push("Original user request:", prompt, "Execution results:", resultsJson, "Your detailed response:");

  return parts.join("\n\n");
}
