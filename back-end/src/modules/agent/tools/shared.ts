// Types and helpers shared by the agent tool definitions.
import { DateTime } from "luxon";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../../config/env";
import type { AgentToolName } from "../../../models/AgentPendingAction";
import { PatientModel } from "../../../models/Patient";
import type { AuthUser, UserRole } from "../../../types/auth";
import { ApiError } from "../../../utils/apiError";

export interface AgentToolContext {
  actor: AuthUser;
}

export interface ToolCatalogItem {
  name: AgentToolName;
  description: string;
  allowedRoles: UserRole[];
  destructive: boolean;
  argsShape: Record<string, string>;
}

export interface AgentToolDefinition<TSchema extends z.ZodTypeAny> {
  description: string;
  allowedRoles: UserRole[];
  destructive: boolean;
  argsShape: Record<string, string>;
  argsSchema: TSchema;
  run: (args: z.infer<TSchema>, context: AgentToolContext) => Promise<unknown>;
}

export function defineTool<TSchema extends z.ZodTypeAny>(
  definition: AgentToolDefinition<TSchema>,
): AgentToolDefinition<TSchema> {
  return definition;
}

export const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");
export const optionalBooleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") {
      return true;
    }

    if (lowered === "false") {
      return false;
    }
  }

  return value;
}, z.boolean().optional());

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use format YYYY-MM-DD");

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "time must use format HH:mm");

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  );
}

export function scoreTextMatch(text: string, terms: string[]): number {
  if (!text || terms.length === 0) {
    return 0;
  }

  const lowered = text.toLowerCase();
  let matched = 0;

  for (const term of terms) {
    if (lowered.includes(term)) {
      matched += 1;
    }
  }

  return matched / terms.length;
}

export function truncateResultContent(value: string, maxLength = 1400): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function parseLocalDateTime(date: string, time: string, zone: string = env.APP_TIMEZONE): DateTime {
  const dateTime = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", {
    zone,
  });

  if (!dateTime.isValid) {
    throw new ApiError(400, `Invalid date/time input: ${date} ${time}`);
  }

  return dateTime;
}

export async function assertPatientAccess(actor: AuthUser, patientId: string): Promise<void> {
  const patient = await PatientModel.findById(patientId).select("assignedStaff");
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }

  if (actor.role === "admin") {
    return;
  }

  const isAssigned = patient.assignedStaff.some((staffId) => staffId.toString() === actor.id);
  if (!isAssigned) {
    throw new ApiError(403, "You are not assigned to this patient");
  }
}

export async function getAccessiblePatientIds(actor: AuthUser): Promise<Types.ObjectId[] | null> {
  if (actor.role === "admin") {
    return null;
  }

  const patients = await PatientModel.find({
    assignedStaff: new Types.ObjectId(actor.id),
  }).select("_id");

  return patients.map((patient) => patient._id);
}
