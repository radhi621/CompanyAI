// The assistant: one conversation loop with native tool calling. The model sees the whole
// conversation (including its earlier tool calls and their results), calls tools, reads what
// they return and answers. Tools that change data are not run here: they are stored as a
// pending action that the user approves or rejects (see agent.service.ts).
import { DateTime } from "luxon";
import { ZodError } from "zod";
import { env } from "../../config/env";
import type { AgentToolName, IAgentToolCall } from "../../models/AgentPendingAction";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import type { ChatMessage, ChatToolCall } from "../../services/llm/chatTypes";
import { type LLMProvider, llmRouter } from "../../services/llm/llmRouter";
import { describePendingAction } from "./agent.confirmation";
import { buildFallbackAnswer } from "./agent.fallbackAnswer";
import {
  executeToolCall,
  getChatTools,
  getToolArgsIssue,
  isAgentToolName,
  isToolAllowedForRole,
  isToolDestructive,
} from "./agent.tools";
import { type ExecutedToolResult, extractErrorMessage } from "./agent.types";

/** Model calls per user message: enough for find → list → act, bounded for quota and latency. */
const MAX_MODEL_TURNS = 6;
const MAX_TOOL_CALLS = 10;
/** A tool result larger than this is cut before it goes back to the model and into storage. */
const MAX_RESULT_CHARS = 8000;
/** Messages sent to the model; older ones stay stored but are not sent. */
const MAX_CONTEXT_MESSAGES = 60;

export interface ChatPatientContext {
  id: string;
  name: string;
  cin?: string;
}

export interface AgentReply {
  /** Who wrote the answer; null when it was built from the data because no provider answered. */
  provider: LLMProvider | null;
  text: string;
  /** Tools run for this message, in order. */
  executed: ExecutedToolResult[];
  /** Calls waiting for the user's approval, if the model asked for a change. */
  pending: IAgentToolCall[];
}

export function buildSystemPrompt(actor: AuthUser, patient: ChatPatientContext | null, now = new Date()): string {
  const clinicNow = DateTime.fromJSDate(now).setZone(env.APP_TIMEZONE);

  return [
    `You are MediAssist, the assistant of a medical office. You are helping ${actor.name}, whose role is ${actor.role}.`,
    `Now: ${clinicNow.toFormat("cccc yyyy-MM-dd HH:mm")} (${env.APP_TIMEZONE}). Dates and times the user gives are in this time zone.`,
    patient
      ? `This chat is about the patient ${patient.name}${patient.cin ? ` (CIN ${patient.cin})` : ""}, ID ${patient.id}. ` +
        '"The patient", "she", "he", "her" and "his" mean this patient unless the user names someone else.'
      : "This chat is not about one patient: find patients by name or CIN when the user mentions one.",
    [
      "How to work:",
      "- Get facts from the tools. Never invent patients, appointments, notes, results or IDs; if a tool finds nothing, say so.",
      "- When the user names a patient, doctor or record, look it up to get its ID yourself instead of asking for the ID.",
      "- The conversation includes your earlier tool calls and their results. Use it for follow-ups such as \"done?\", " +
        '"and her appointments?" or "delete the second one": answer from it, and call tools again only for information ' +
        "you do not have or that may have changed.",
      "- Tools that change data (create, update, cancel, delete, add a note) do not run straight away: the user sees the " +
        "action and approves or rejects it in the app. When the user asks for a change, call the tool directly with real " +
        "IDs; do not ask \"are you sure?\" yourself and do not call it twice. The conversation shows later whether the user " +
        "approved it (and the result) or rejected it.",
      "- If a request is ambiguous (several matching patients, no date given), ask one short question instead of guessing.",
      "- If a tool returns an error, correct the call (for example look up the missing ID) or explain the problem briefly.",
      "- You support medical staff; you do not diagnose or prescribe. Report what the records say.",
    ].join("\n"),
    [
      "How to answer:",
      "- Reply in the language of the user's latest message (English when it is unclear, as for \"hi\" or \"ok\"), " +
        "concisely and factually: no preamble, and do not describe which tools you used.",
      "- Use Markdown. Two or more records: a table with readable columns first and the full ID last, in backticks " +
        "(for example `6ac7f8e295fc5deac8262ee7`); never shorten IDs. One record: a short bold-labelled list.",
      "- Dates as YYYY-MM-DD and times as HH:mm in the clinic time zone. Use a dash (—) for missing values.",
      "- Write tables compactly: one space on each side of every cell, no padding to align columns.",
    ].join("\n"),
  ].join("\n\n");
}

/**
 * The messages sent to the model: the most recent ones, starting at a user message so a tool
 * result is never separated from the call it answers.
 */
export function contextWindow(messages: ChatMessage[]): ChatMessage[] {
  let start = Math.max(0, messages.length - MAX_CONTEXT_MESSAGES);
  while (start < messages.length && messages[start].role !== "user") {
    start += 1;
  }
  return messages.slice(start);
}

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Plain JSON for the model and for storage, cut when large. Timestamps are given in clinic
 * time (with their offset): models copy times as written, so UTC would show wrong hours.
 */
export function toStoredResult(result: unknown): unknown {
  const json = JSON.stringify(result ?? null, (_key, value: unknown) =>
    typeof value === "string" && UTC_TIMESTAMP.test(value)
      ? DateTime.fromISO(value).setZone(env.APP_TIMEZONE).toISO({ suppressMilliseconds: true })
      : value,
  );
  if (json.length <= MAX_RESULT_CHARS) {
    return JSON.parse(json);
  }
  return { truncated: true, preview: json.slice(0, MAX_RESULT_CHARS) };
}

type CallOutcome =
  | { kind: "result"; value: unknown; executed?: ExecutedToolResult }
  | { kind: "pending"; call: IAgentToolCall };

async function runToolCall(actor: AuthUser, call: ChatToolCall, budget: { left: number }): Promise<CallOutcome> {
  if (!isAgentToolName(call.name)) {
    return { kind: "result", value: { error: `Unknown tool ${call.name}.` } };
  }
  const tool: AgentToolName = call.name;

  if (!isToolAllowedForRole(tool, actor.role)) {
    return { kind: "result", value: { error: `The ${actor.role} role cannot use ${tool}.` } };
  }

  const agentCall: IAgentToolCall = { tool, args: call.args ?? {} };

  if (isToolDestructive(tool)) {
    // Approved actions run exactly as stored, so their arguments must be complete and valid now.
    const issue = getToolArgsIssue(agentCall);
    return issue
      ? { kind: "result", value: { error: `Invalid arguments: ${issue}. Look up the missing IDs first.` } }
      : { kind: "pending", call: agentCall };
  }

  if (budget.left <= 0) {
    return { kind: "result", value: { error: "Tool call limit reached for this message. Answer with what you have." } };
  }
  budget.left -= 1;

  try {
    const result = await executeToolCall(agentCall, { actor });
    return { kind: "result", value: result, executed: { tool, args: agentCall.args, result } };
  } catch (error) {
    if (error instanceof ApiError) {
      return { kind: "result", value: { error: error.message } };
    }
    if (error instanceof ZodError) {
      return {
        kind: "result",
        value: { error: `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` },
      };
    }
    console.error(`[Agent] Tool ${tool} failed:`, error);
    return { kind: "result", value: { error: `The ${tool} tool failed unexpectedly.` } };
  }
}

/**
 * Answers one user message. `messages` is the stored conversation; the user's message, the
 * model's tool calls, their results and the answer are appended to it.
 */
export async function answerMessage(input: {
  actor: AuthUser;
  messages: ChatMessage[];
  text: string;
  patient: ChatPatientContext | null;
}): Promise<AgentReply> {
  const { actor, messages } = input;
  const system = buildSystemPrompt(actor, input.patient);
  const tools = getChatTools(actor.role);
  const executed: ExecutedToolResult[] = [];
  const budget = { left: MAX_TOOL_CALLS };
  let provider: LLMProvider | null = null;

  messages.push({ role: "user", text: input.text });

  const finish = (text: string, pending: IAgentToolCall[] = []): AgentReply => {
    messages.push({ role: "assistant", text });
    return { provider, text, executed, pending };
  };

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
    let reply: Awaited<ReturnType<typeof llmRouter.chat>>;
    try {
      reply = await llmRouter.chat({ system, messages: contextWindow(messages), tools });
    } catch (error) {
      if (executed.length === 0) {
        messages.pop(); // the message was not answered; it is not kept
        throw error;
      }
      console.error(`[Agent] Writing the answer failed, showing the data instead: ${extractErrorMessage(error)}`);
      provider = null;
      return finish(buildFallbackAnswer(executed));
    }

    provider = reply.provider;
    const { text, toolCalls } = reply.turn;
    if (toolCalls.length === 0) {
      return finish(text ?? "");
    }

    messages.push({ role: "assistant", ...(text ? { text } : {}), toolCalls });

    const pending: IAgentToolCall[] = [];
    for (const call of toolCalls) {
      const outcome = await runToolCall(actor, call, budget);
      if (outcome.kind === "pending") {
        pending.push(outcome.call);
        messages.push({
          role: "tool",
          callId: call.id,
          name: call.name,
          result: { status: "awaiting_user_approval", note: "Shown to the user for approval; not run yet." },
        });
      } else {
        if (outcome.executed) {
          executed.push(outcome.executed);
        }
        messages.push({ role: "tool", callId: call.id, name: call.name, result: toStoredResult(outcome.value) });
      }
    }

    if (pending.length > 0) {
      const knownResults = messages.flatMap((message) => (message.role === "tool" ? [message.result] : []));
      return finish(describePendingAction(pending, knownResults), pending);
    }
  }

  return finish(
    executed.length > 0
      ? buildFallbackAnswer(executed)
      : "I could not complete this request. Please rephrase it or split it into smaller steps.",
  );
}
