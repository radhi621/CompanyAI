import { DateTime } from "luxon";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../config/env";
import { AIRecordModel } from "../../models/AIRecord";
import { type AppointmentStatus, AppointmentModel } from "../../models/Appointment";
import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type IAgentToolCall,
} from "../../models/AgentPendingAction";
import { PatientModel } from "../../models/Patient";
import { PatientNoteModel } from "../../models/PatientNote";
import { UserModel } from "../../models/User";
import type { AuthUser, UserRole } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { createUser as createUserAccount } from "../auth/auth.service";
import { appointmentsService } from "../appointments/appointments.service";
import { doctorsService } from "../doctors/doctors.service";
import { patientsService } from "../patients/patients.service";
import { ragService } from "../../services/rag/ragService";

interface AgentToolContext {
  actor: AuthUser;
}

interface ToolCatalogItem {
  name: AgentToolName;
  description: string;
  allowedRoles: UserRole[];
  destructive: boolean;
  argsShape: Record<string, string>;
}

interface AgentToolDefinition<TSchema extends z.ZodTypeAny> {
  description: string;
  allowedRoles: UserRole[];
  destructive: boolean;
  argsShape: Record<string, string>;
  argsSchema: TSchema;
  run: (args: z.infer<TSchema>, context: AgentToolContext) => Promise<unknown>;
}

function defineTool<TSchema extends z.ZodTypeAny>(
  definition: AgentToolDefinition<TSchema>,
): AgentToolDefinition<TSchema> {
  return definition;
}

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");
const userRoleSchema = z.enum(["admin", "doctor", "nurse", "secretary"]);
const optionalBooleanSchema = z.preprocess((value) => {
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

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use format YYYY-MM-DD");

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "time must use format HH:mm");

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSearchTerms(query: string): string[] {
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

function scoreTextMatch(text: string, terms: string[]): number {
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

function truncateResultContent(value: string, maxLength = 1400): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseLocalDateTime(date: string, time: string): DateTime {
  const dateTime = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", {
    zone: env.APP_TIMEZONE,
  });

  if (!dateTime.isValid) {
    throw new ApiError(400, `Invalid date/time input: ${date} ${time}`);
  }

  return dateTime;
}

async function assertPatientAccess(actor: AuthUser, patientId: string): Promise<void> {
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

async function getAccessiblePatientIds(actor: AuthUser): Promise<Types.ObjectId[] | null> {
  if (actor.role === "admin") {
    return null;
  }

  const patients = await PatientModel.find({
    assignedStaff: new Types.ObjectId(actor.id),
  }).select("_id");

  return patients.map((patient) => patient._id);
}

const toolRegistry = {
  create_patient: defineTool({
    description: "Creates a patient profile in the medical department",
    allowedRoles: ["admin", "secretary"],
    destructive: false,
    argsShape: {
      firstName: "required string",
      lastName: "required string",
      cin: "required string",
      phone: "optional string",
      email: "optional email",
      dateOfBirth: "optional date string",
      pathologies: "optional array of strings",
      assignedStaff: "optional array of MongoDB ObjectId",
    },
    argsSchema: z.object({
      firstName: z.string().min(2),
      lastName: z.string().min(2),
      cin: z.string().min(4).max(20),
      phone: z.string().min(5).max(30).optional(),
      email: z.string().email().optional(),
      dateOfBirth: z.coerce.date().optional(),
      pathologies: z.array(z.string().min(2).max(100)).optional(),
      assignedStaff: z.array(objectIdSchema).optional(),
    }),
    run: async (args, context) => {
      const patient = await patientsService.create({
        actor: context.actor,
        firstName: args.firstName.trim(),
        lastName: args.lastName.trim(),
        cin: args.cin.trim(),
        phone: args.phone?.trim(),
        email: args.email?.trim().toLowerCase(),
        dateOfBirth: args.dateOfBirth,
        pathologies: args.pathologies,
        assignedStaff: args.assignedStaff,
      });

      return {
        patientId: patient._id.toString(),
        firstName: patient.firstName,
        lastName: patient.lastName,
        cin: patient.cin,
        phone: patient.phone ?? null,
        email: patient.email ?? null,
        pathologies: patient.pathologies,
        assignedStaff: patient.assignedStaff.map((item) => item.toString()),
      };
    },
  }),

  list_patients: defineTool({
    description: "Lists accessible patients for the requester",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
    run: async (args, context) => {
      const patients = await patientsService.list({
        actor: context.actor,
        limit: args.limit,
      });

      return {
        total: patients.length,
        patients,
      };
    },
  }),

  search_patient: defineTool({
    description: "Searches patients by name or CIN",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      name: "optional string",
      cin: "optional string",
      limit: "optional number max 50",
    },
    argsSchema: z
      .object({
        name: z.string().min(2).optional(),
        cin: z.string().min(4).optional(),
        limit: z.coerce.number().int().positive().max(50).default(10),
      })
      .refine((value) => value.name || value.cin, {
        message: "name or cin is required",
      }),
    run: async (args, context) => {
      const query: Record<string, unknown> = {};

      if (args.cin) {
        query.cin = args.cin.trim().toUpperCase();
      }

      if (args.name) {
        const terms = args.name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((term) => new RegExp(escapeRegex(term), "i"));

        query.$or = [
          { firstName: { $in: terms } },
          { lastName: { $in: terms } },
          {
            $and: terms.map((regex) => ({
              $or: [{ firstName: regex }, { lastName: regex }],
            })),
          },
        ];
      }

      if (context.actor.role !== "admin") {
        query.assignedStaff = new Types.ObjectId(context.actor.id);
      }

      const patients = await PatientModel.find(query)
        .select("firstName lastName cin phone email pathologies")
        .sort({ lastName: 1, firstName: 1 })
        .limit(args.limit);

      return {
        total: patients.length,
        patients,
      };
    },
  }),

  get_patient_summary: defineTool({
    description: "Returns a consolidated patient summary",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
    }),
    run: async (args, context) => {
      await assertPatientAccess(context.actor, args.patientId);

      const patient = await PatientModel.findById(args.patientId);
      if (!patient) {
        throw new ApiError(404, "Patient not found");
      }

      const recentAppointments = await AppointmentModel.find({
        patientId: patient._id,
        deletedAt: { $exists: false },
      })
        .sort({ startAt: -1 })
        .limit(5)
        .populate("doctorId", "fullName specialty");

      const recentNotes = await PatientNoteModel.find({
        patientId: patient._id,
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("createdBy", "name role");

      const recentAIRecords = await AIRecordModel.find({
        patientId: patient._id,
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .select("title mode provider createdAt");

      return {
        patient,
        recentAppointments,
        recentNotes,
        recentAIRecords,
      };
    },
  }),

  list_appointments: defineTool({
    description: "Lists appointments by optional patient/doctor/date filters",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "optional MongoDB ObjectId",
      doctorId: "optional MongoDB ObjectId",
      date: "optional YYYY-MM-DD",
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      patientId: objectIdSchema.optional(),
      doctorId: objectIdSchema.optional(),
      date: localDateSchema.optional(),
      limit: z.coerce.number().int().positive().max(100).default(30),
    }),
    run: async (args, context) => {
      let from: Date | undefined;
      let to: Date | undefined;

      if (args.date) {
        const start = DateTime.fromISO(args.date, { zone: env.APP_TIMEZONE }).startOf("day");
        from = start.toUTC().toJSDate();
        to = start.endOf("day").toUTC().toJSDate();
      }

      return appointmentsService.list({
        actor: context.actor,
        patientId: args.patientId,
        doctorId: args.doctorId,
        from,
        to,
        limit: args.limit,
      });
    },
  }),

  check_availability: defineTool({
    description: "Checks whether a doctor is available at a given local date/time",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      doctorId: "required MongoDB ObjectId",
      date: "required YYYY-MM-DD",
      time: "required HH:mm",
      estimatedDurationMinutes: "optional number",
    },
    argsSchema: z.object({
      doctorId: objectIdSchema,
      date: localDateSchema,
      time: localTimeSchema,
      estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
    }),
    run: async (args, context) => {
      const requested = parseLocalDateTime(args.date, args.time);

      const duration = args.estimatedDurationMinutes ?? env.DEFAULT_APPOINTMENT_DURATION_MINUTES;
      const slots = await doctorsService.getAvailableSlots({
        actor: context.actor,
        doctorId: args.doctorId,
        date: args.date,
        days: 1,
        estimatedDurationMinutes: duration,
      });

      const requestedMinute = Math.floor(requested.toUTC().toMillis() / 60000);
      const isAvailable = slots.some((slot) => {
        const slotMinute = Math.floor(DateTime.fromISO(slot.startAtUtc).toUTC().toMillis() / 60000);
        return slotMinute === requestedMinute;
      });

      return {
        doctorId: args.doctorId,
        requestedStartAtLocal: requested.toISO(),
        requestedStartAtUtc: requested.toUTC().toISO(),
        timezone: env.APP_TIMEZONE,
        estimatedDurationMinutes: duration,
        isAvailable,
        suggestedSlots: slots.slice(0, 5),
      };
    },
  }),

  create_appointment: defineTool({
    description: "Creates an appointment from local date/time and reason",
    allowedRoles: ["admin", "doctor", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      doctorId: "required MongoDB ObjectId",
      date: "required YYYY-MM-DD",
      time: "required HH:mm",
      motif: "required string",
      estimatedDurationMinutes: "optional number",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      doctorId: objectIdSchema,
      date: localDateSchema,
      time: localTimeSchema,
      motif: z.string().min(3).max(600),
      estimatedDurationMinutes: z.coerce.number().int().positive().max(720).optional(),
    }),
    run: async (args, context) => {
      const localStart = parseLocalDateTime(args.date, args.time);
      const appointment = await appointmentsService.create({
        actor: context.actor,
        patientId: args.patientId,
        doctorId: args.doctorId,
        startAt: localStart.toUTC().toJSDate(),
        estimatedDurationMinutes: args.estimatedDurationMinutes,
        reason: args.motif,
        source: "ai",
      });

      return {
        appointmentId: appointment._id.toString(),
        status: appointment.status,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      };
    },
  }),

  cancel_appointment: defineTool({
    description: "Cancels an appointment by setting status to cancelled",
    allowedRoles: ["admin", "doctor", "secretary"],
    destructive: true,
    argsShape: {
      appointmentId: "required MongoDB ObjectId",
      reason: "optional string",
    },
    argsSchema: z.object({
      appointmentId: objectIdSchema,
      reason: z.string().max(600).optional(),
    }),
    run: async (args, context) => {
      const appointment = await appointmentsService.update({
        actor: context.actor,
        appointmentId: args.appointmentId,
        status: "cancelled",
        notes: args.reason,
      });

      return {
        appointmentId: appointment._id.toString(),
        status: appointment.status,
      };
    },
  }),

  get_uncontacted_patients: defineTool({
    description: "Returns patients with no recent contact in the requested number of days",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      days: "required number",
      pathology: "optional string",
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      days: z.coerce.number().int().positive().max(3650),
      pathology: z.string().min(2).max(100).optional(),
      limit: z.coerce.number().int().positive().max(100).default(30),
    }),
    run: async (args, context) => {
      const patientQuery: Record<string, unknown> = {};

      if (context.actor.role !== "admin") {
        patientQuery.assignedStaff = new Types.ObjectId(context.actor.id);
      }

      if (args.pathology) {
        patientQuery.pathologies = {
          $elemMatch: {
            $regex: new RegExp(`^${escapeRegex(args.pathology)}$`, "i"),
          },
        };
      }

      const patients = await PatientModel.find(patientQuery)
        .select("firstName lastName cin pathologies")
        .sort({ lastName: 1, firstName: 1 });

      if (patients.length === 0) {
        return {
          total: 0,
          patients: [],
        };
      }

      const patientIds = patients.map((patient) => patient._id);
      const lastContacts = await AppointmentModel.aggregate<{
        _id: Types.ObjectId;
        lastContactAt: Date;
      }>([
        {
          $match: {
            patientId: { $in: patientIds },
            deletedAt: { $exists: false },
            status: { $in: ["completed", "confirmed", "in_progress"] as AppointmentStatus[] },
          },
        },
        {
          $group: {
            _id: "$patientId",
            lastContactAt: { $max: "$startAt" },
          },
        },
      ]);

      const contactMap = new Map(lastContacts.map((item) => [item._id.toString(), item.lastContactAt]));
      const cutoff = DateTime.now().minus({ days: args.days }).toJSDate();

      const uncontacted = patients
        .map((patient) => {
          const lastContactAt = contactMap.get(patient._id.toString());
          return {
            patient,
            lastContactAt: lastContactAt ?? null,
          };
        })
        .filter((item) => !item.lastContactAt || item.lastContactAt < cutoff)
        .slice(0, args.limit);

      return {
        total: uncontacted.length,
        daysThreshold: args.days,
        patients: uncontacted,
      };
    },
  }),

  search_medical_records_RAG: defineTool({
    description: "Performs semantic search in patient indexed records (RAG)",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      query: "required string",
      limit: "optional number",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      query: z.string().min(3).max(2000),
      limit: z.coerce.number().int().positive().max(10).default(5),
    }),
    run: async (args, context) => {
      await assertPatientAccess(context.actor, args.patientId);
      const chunks = await ragService.retrieveContext(args.patientId, args.query, args.limit);

      if (chunks.length > 0) {
        return {
          patientId: args.patientId,
          query: args.query,
          matches: chunks,
        };
      }

      const terms = extractSearchTerms(args.query);
      if (terms.length === 0) {
        return {
          patientId: args.patientId,
          query: args.query,
          matches: [],
          fallbackUsed: "mongo_ai_records",
        };
      }

      const records = await AIRecordModel.find({
        patientId: new Types.ObjectId(args.patientId),
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(25)
        .select("_id mode provider response contextChunks createdAt");

      const fallbackMatches = records
        .flatMap((record) => {
          const responseText = record.response?.trim() ?? "";
          const responseScore = scoreTextMatch(responseText, terms);

          const responseMatch =
            responseScore > 0
              ? [
                  {
                    sourceId: `record:${record._id.toString()}:response`,
                    content: truncateResultContent(responseText),
                    score: responseScore,
                    sourceLabel: `mongo_record_${record.mode}`,
                    metadata: {
                      recordId: record._id.toString(),
                      provider: record.provider,
                      createdAt: record.createdAt?.toISOString?.(),
                      fallback: true,
                      sourceType: "record_response",
                    },
                  },
                ]
              : [];

          const chunkMatches = record.contextChunks
            .map((chunk, index) => {
              const chunkText = (chunk.content ?? "").trim();
              const chunkScore = scoreTextMatch(chunkText, terms);
              if (chunkScore <= 0) {
                return null;
              }

              return {
                sourceId: `record:${record._id.toString()}:chunk:${index}`,
                content: truncateResultContent(chunkText),
                score: chunkScore,
                sourceLabel: chunk.sourceLabel || `mongo_chunk_${record.mode}`,
                metadata: {
                  ...(chunk.metadata ?? {}),
                  recordId: record._id.toString(),
                  provider: record.provider,
                  createdAt: record.createdAt?.toISOString?.(),
                  fallback: true,
                  sourceType: "context_chunk",
                },
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          return [...responseMatch, ...chunkMatches];
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit);

      return {
        patientId: args.patientId,
        query: args.query,
        matches: fallbackMatches,
        fallbackUsed: "mongo_ai_records",
      };
    },
  }),

  update_patient_notes: defineTool({
    description: "Adds a new note to a patient record with ownership tracking",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      note: "required string",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      note: z.string().min(3).max(4000),
    }),
    run: async (args, context) => {
      await assertPatientAccess(context.actor, args.patientId);

      const note = await PatientNoteModel.create({
        patientId: new Types.ObjectId(args.patientId),
        content: args.note,
        createdBy: new Types.ObjectId(context.actor.id),
        createdByRole: context.actor.role,
      });

      return {
        noteId: note._id.toString(),
        patientId: args.patientId,
        createdAt: note.createdAt,
      };
    },
  }),

  get_day_schedule: defineTool({
    description: "Returns the schedule for a day, optionally filtered by doctor",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      date: "required YYYY-MM-DD",
      doctorId: "optional MongoDB ObjectId",
    },
    argsSchema: z.object({
      date: localDateSchema,
      doctorId: objectIdSchema.optional(),
    }),
    run: async (args, context) => {
      const localStart = DateTime.fromISO(args.date, { zone: env.APP_TIMEZONE }).startOf("day");
      if (!localStart.isValid) {
        throw new ApiError(400, "Invalid date");
      }

      const dayStart = localStart.toUTC().toJSDate();
      const dayEnd = localStart.endOf("day").toUTC().toJSDate();

      const query: Record<string, unknown> = {
        deletedAt: { $exists: false },
        startAt: {
          $gte: dayStart,
          $lte: dayEnd,
        },
      };

      if (args.doctorId) {
        query.doctorId = new Types.ObjectId(args.doctorId);
      }

      const accessiblePatientIds = await getAccessiblePatientIds(context.actor);
      if (accessiblePatientIds) {
        if (accessiblePatientIds.length === 0) {
          return {
            date: args.date,
            timezone: env.APP_TIMEZONE,
            appointments: [],
          };
        }

        query.patientId = {
          $in: accessiblePatientIds,
        };
      }

      const appointments = await AppointmentModel.find(query)
        .sort({ startAt: 1 })
        .populate("patientId", "firstName lastName cin")
        .populate("doctorId", "fullName specialty");

      return {
        date: args.date,
        timezone: env.APP_TIMEZONE,
        appointments,
      };
    },
  }),

  create_staff_account: defineTool({
    description: "Creates a staff login account (admin-only)",
    allowedRoles: ["admin"],
    destructive: false,
    argsShape: {
      name: "required string",
      email: "required email",
      password: "required string min 8",
      role: "required role: admin|doctor|nurse|secretary",
    },
    argsSchema: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      role: userRoleSchema,
    }),
    run: async (args) => {
      const user = await createUserAccount({
        name: args.name.trim(),
        email: args.email.trim().toLowerCase(),
        password: args.password,
        role: args.role,
      });

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      };
    },
  }),

  create_doctor_profile: defineTool({
    description: "Creates a doctor profile and can link it to an existing doctor user",
    allowedRoles: ["admin"],
    destructive: false,
    argsShape: {
      fullName: "required string",
      specialty: "required string",
      userId: "optional MongoDB ObjectId",
      userEmail: "optional email to link doctor account",
      licenseNumber: "optional string",
      isActive: "optional boolean",
    },
    argsSchema: z
      .object({
        fullName: z.string().min(3).max(120),
        specialty: z.string().min(2).max(80),
        userId: objectIdSchema.optional(),
        userEmail: z.string().email().optional(),
        licenseNumber: z.string().min(3).max(60).optional(),
        isActive: optionalBooleanSchema,
      })
      .refine((value) => !(value.userId && value.userEmail), {
        message: "Provide either userId or userEmail, not both",
      }),
    run: async (args, context) => {
      let resolvedUserId = args.userId;

      if (args.userEmail) {
        const user = await UserModel.findOne({
          email: args.userEmail.trim().toLowerCase(),
        }).select("_id role");

        if (!user) {
          throw new ApiError(404, `User not found for email ${args.userEmail}`);
        }

        if (user.role !== "doctor") {
          throw new ApiError(400, "Linked user must have role doctor");
        }

        resolvedUserId = user._id.toString();
      }

      const doctor = await doctorsService.create({
        actor: context.actor,
        userId: resolvedUserId,
        fullName: args.fullName,
        specialty: args.specialty,
        licenseNumber: args.licenseNumber,
        isActive: args.isActive,
      });

      return {
        doctorId: doctor._id.toString(),
        fullName: doctor.fullName,
        specialty: doctor.specialty,
        licenseNumber: doctor.licenseNumber ?? null,
        userId: doctor.userId ? doctor.userId.toString() : null,
        isActive: doctor.isActive,
      };
    },
  }),

  list_doctors: defineTool({
    description: "Lists doctors in the facility with optional specialty and active filters",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      specialty: "optional string",
      isActive: "optional boolean",
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      specialty: z.string().min(2).optional(),
      isActive: optionalBooleanSchema,
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
    run: async (args) => {
      const doctors = await doctorsService.list({
        specialty: args.specialty?.trim(),
        isActive: args.isActive,
        limit: args.limit,
      });

      return {
        total: doctors.length,
        doctors,
      };
    },
  }),
} satisfies {
  [K in AgentToolName]: AgentToolDefinition<z.ZodTypeAny>;
};

export const getToolCatalogForPrompt = (): ToolCatalogItem[] => {
  return AGENT_TOOL_NAMES.map((toolName) => {
    const definition = toolRegistry[toolName];
    return {
      name: toolName,
      description: definition.description,
      allowedRoles: definition.allowedRoles,
      destructive: definition.destructive,
      argsShape: definition.argsShape,
    };
  });
};

export const isToolDestructive = (tool: AgentToolName): boolean => {
  return toolRegistry[tool].destructive;
};

export const isToolAllowedForRole = (tool: AgentToolName, role: UserRole): boolean => {
  return toolRegistry[tool].allowedRoles.includes(role);
};

export const executeToolCall = async (
  call: IAgentToolCall,
  context: AgentToolContext,
): Promise<unknown> => {
  const definition = toolRegistry[call.tool];
  if (!definition.allowedRoles.includes(context.actor.role)) {
    throw new ApiError(403, `Role ${context.actor.role} cannot execute tool ${call.tool}`);
  }

  const parsedArgs = definition.argsSchema.parse(call.args ?? {}) as never;
  return definition.run(parsedArgs, context);
};