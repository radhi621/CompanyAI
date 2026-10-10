// Patient tools: records, lookups and notes.
import { DateTime } from "luxon";
import { Types } from "mongoose";
import { z } from "zod";
import { AIRecordModel } from "../../../models/AIRecord";
import { type AppointmentStatus, AppointmentModel } from "../../../models/Appointment";
import { PatientModel } from "../../../models/Patient";
import { PatientNoteModel } from "../../../models/PatientNote";
import { ApiError } from "../../../utils/apiError";
import { patientNotesService } from "../../patients/patientNotes.service";
import { patientsService } from "../../patients/patients.service";
import { defineTool, objectIdSchema, escapeRegex, assertPatientAccess } from "./shared";

export const patientsTools = {
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
  update_patient: defineTool({
    description:
      "Updates patient fields such as name, phone, email, date of birth, or pathologies (add with pathologies, remove with removePathologies)",
    allowedRoles: ["admin", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      firstName: "optional string",
      lastName: "optional string",
      phone: "optional string",
      email: "optional email",
      dateOfBirth: "optional date string YYYY-MM-DD",
      pathologies: "optional array of strings to add",
      removePathologies: "optional array of strings to remove",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      firstName: z.string().trim().min(2).max(80).optional(),
      lastName: z.string().trim().min(2).max(80).optional(),
      phone: z.string().min(5).max(30).optional(),
      email: z.string().email().optional(),
      dateOfBirth: z.coerce.date().optional(),
      pathologies: z.array(z.string().min(2).max(100)).optional(),
      removePathologies: z.array(z.string().min(1).max(100)).optional(),
    }),
    run: async (args, context) => {
      const patient = await patientsService.update(
        args.patientId,
        {
          firstName: args.firstName,
          lastName: args.lastName,
          phone: args.phone?.trim(),
          email: args.email?.trim().toLowerCase(),
          dateOfBirth: args.dateOfBirth,
          pathologies: args.pathologies,
          removePathologies: args.removePathologies,
        },
        context.actor,
      );

      return {
        patientId: patient._id.toString(),
        firstName: patient.firstName,
        lastName: patient.lastName,
        cin: patient.cin,
        phone: patient.phone ?? null,
        email: patient.email ?? null,
        dateOfBirth: patient.dateOfBirth ?? null,
        pathologies: patient.pathologies,
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
      const note = await patientNotesService.create(args.patientId, context.actor, args.note);

      return {
        noteId: note._id.toString(),
        patientId: args.patientId,
        createdAt: note.createdAt,
      };
    },
  }),
  list_patient_notes: defineTool({
    description: "Lists patient notes from the database, ordered by most recent",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      patientId: "required MongoDB ObjectId",
      limit: "optional number max 50",
    },
    argsSchema: z.object({
      patientId: objectIdSchema,
      limit: z.coerce.number().int().positive().max(50).default(20),
    }),
    run: async (args, context) => {
      const notes = await patientNotesService.list(args.patientId, context.actor, args.limit);

      return {
        patientId: args.patientId,
        total: notes.length,
        notes: notes.map((note) => ({
          noteId: note._id.toString(),
          content: note.content,
          createdBy: (note.createdBy as unknown as { name?: string })?.name ?? "Unknown",
          createdByRole: note.createdByRole,
          createdAt: note.createdAt,
        })),
      };
    },
  }),
  delete_patient_note: defineTool({
    description: "Soft-deletes a specific patient note by its ID. Admin can delete any note; other roles can only delete their own notes.",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: true,
    argsShape: {
      noteId: "required MongoDB ObjectId",
    },
    argsSchema: z.object({
      noteId: objectIdSchema,
    }),
    run: async (args, context) => {
      const note = await patientNotesService.softDelete(args.noteId, context.actor);

      return {
        noteId: note._id.toString(),
        deletedAt: note.deletedAt,
      };
    },
  }),
};
