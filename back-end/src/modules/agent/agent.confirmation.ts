// The message shown when a destructive action waits for the user's approval. When the
// assistant found the IDs itself (for example the note to delete), the user must see which
// record each action targets before approving, not only the tool name.
import { DateTime } from "luxon";
import { env } from "../../config/env";
import type { IAgentToolCall } from "../../models/AgentPendingAction";
import type { ExecutedToolResult } from "./agent.types";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const MAX_TEXT_CHARS = 120;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function short(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_TEXT_CHARS ? `${oneLine.slice(0, MAX_TEXT_CHARS - 1)}…` : oneLine;
}

/** Every object in the results, at any depth, so an ID can be matched to the record it names. */
function collectRows(value: unknown, rows: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRows(item, rows));
  } else if (isRow(value)) {
    rows.push(value);
    Object.values(value).forEach((item) => collectRows(item, rows));
  }
  return rows;
}

function rowId(row: Row): string | null {
  for (const key of ["_id", "id", "noteId", "appointmentId", "recordId"]) {
    const value = row[key];
    if (typeof value === "string" && OBJECT_ID.test(value)) {
      return value;
    }
  }
  return null;
}

/** A short human description of a record: its date, people and text, whichever it has. */
function describeRow(row: Row): string {
  const parts: string[] = [];
  // Dates are Date objects in tool results, ISO strings once serialized; shown in clinic time.
  const date = row.startAt ?? row.createdAt ?? row.date;
  const parsed =
    date instanceof Date ? DateTime.fromJSDate(date) : typeof date === "string" ? DateTime.fromISO(date) : null;
  if (parsed?.isValid) {
    parts.push(parsed.setZone(env.APP_TIMEZONE).toFormat("yyyy-MM-dd HH:mm"));
  }

  const name = [row.firstName, row.lastName].filter((part) => typeof part === "string").join(" ");
  if (name) {
    parts.push(name);
  }

  for (const key of ["author", "createdByName", "doctorName", "patientName"]) {
    if (typeof row[key] === "string") {
      parts.push(row[key] as string);
    }
  }

  // createdBy is a name in tool results, or a populated user; never print a bare user ID.
  const author = row.createdBy;
  if (typeof author === "string" && !OBJECT_ID.test(author)) {
    parts.push(author);
  } else if (isRow(author) && typeof author.name === "string") {
    parts.push(author.name);
  }

  const text = row.content ?? row.reason ?? row.title;
  if (typeof text === "string" && text.trim()) {
    parts.push(`"${short(text)}"`);
  }

  return parts.join(", ");
}

function describeCall(call: IAgentToolCall, rowsById: Map<string, Row>): string {
  const details = Object.entries(call.args ?? {}).map(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const row = typeof value === "string" ? rowsById.get(value) : undefined;
    const description = row ? describeRow(row) : "";
    return description ? `${key} \`${text}\` (${description})` : `${key} ${short(text)}`;
  });

  return `- **${call.tool}**${details.length > 0 ? `: ${details.join("; ")}` : ""}`;
}

export function describePendingAction(calls: IAgentToolCall[], results: ExecutedToolResult[]): string {
  const rowsById = new Map<string, Row>();
  for (const row of collectRows(results.map((entry) => entry.result))) {
    const id = rowId(row);
    if (id && !rowsById.has(id)) {
      rowsById.set(id, row);
    }
  }

  return [
    "Please confirm before anything is changed:",
    ...calls.map((call) => describeCall(call, rowsById)),
    "Approve to run it, or reject to cancel.",
  ].join("\n");
}
