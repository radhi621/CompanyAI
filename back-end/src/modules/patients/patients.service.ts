import { Types } from "mongoose";
import { PatientModel, type IPatientDocument } from "../../models/Patient";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";

interface CreatePatientInput {
  actor: AuthUser;
  firstName: string;
  lastName: string;
  cin: string;
  phone?: string;
  email?: string;
  dateOfBirth?: Date;
  pathologies?: string[];
  assignedStaff?: string[];
}

interface ListPatientsInput {
  actor: AuthUser;
  limit: number;
}

export const patientsService = {
  async create(input: CreatePatientInput): Promise<IPatientDocument> {
    const cin = input.cin.trim().toUpperCase();
    const existing = await PatientModel.exists({ cin });
    if (existing) {
      throw new ApiError(409, "Patient with this CIN already exists");
    }

    const assignmentSet = new Set<string>(input.assignedStaff ?? []);
    if (input.actor.role !== "admin") {
      assignmentSet.add(input.actor.id);
    }

    const assignedStaffIds = Array.from(assignmentSet).map((id) => new Types.ObjectId(id));

    return PatientModel.create({
      firstName: input.firstName,
      lastName: input.lastName,
      cin,
      phone: input.phone,
      email: input.email,
      dateOfBirth: input.dateOfBirth,
      pathologies: input.pathologies ?? [],
      assignedStaff: assignedStaffIds,
      createdBy: new Types.ObjectId(input.actor.id),
    });
  },

  async list(input: ListPatientsInput): Promise<IPatientDocument[]> {
    if (input.actor.role === "admin") {
      return PatientModel.find({}).sort({ createdAt: -1 }).limit(input.limit);
    }

    return PatientModel.find({
      assignedStaff: new Types.ObjectId(input.actor.id),
    })
      .sort({ createdAt: -1 })
      .limit(input.limit);
  },

  async getById(patientId: string, actor: AuthUser): Promise<IPatientDocument> {
    const query =
      actor.role === "admin"
        ? { _id: patientId }
        : { _id: patientId, assignedStaff: new Types.ObjectId(actor.id) };

    const patient = await PatientModel.findOne(query);
    if (!patient) {
      throw new ApiError(404, "Patient not found or access denied");
    }

    return patient;
  },

  async updateAssignments(patientId: string, staffIds: string[]): Promise<IPatientDocument> {
    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    patient.assignedStaff = Array.from(new Set(staffIds)).map((id) => new Types.ObjectId(id));
    await patient.save();
    return patient;
  },
};