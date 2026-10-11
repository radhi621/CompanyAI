import { Types } from "mongoose";
import { PatientModel } from "../../models/Patient";
import { PatientNoteModel, type IPatientNoteDocument } from "../../models/PatientNote";
import type { AuthUser } from "../../types/auth";
import { ApiError } from "../../utils/apiError";

async function assertPatientAccess(patientId: string, actor: AuthUser): Promise<void> {
  const patient = await PatientModel.findById(patientId).select("assignedStaff");
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }

  if (actor.role !== "admin" && !patient.assignedStaff.some((staffId) => staffId.toString() === actor.id)) {
    throw new ApiError(403, "You are not assigned to this patient");
  }
}

async function getEditableNote(noteId: string, actor: AuthUser, patientId?: string): Promise<IPatientNoteDocument> {
  const note = await PatientNoteModel.findOne({
    _id: new Types.ObjectId(noteId),
    ...(patientId ? { patientId: new Types.ObjectId(patientId) } : {}),
    deletedAt: { $exists: false },
  });

  if (!note) {
    throw new ApiError(404, "Patient note not found or already deleted");
  }

  await assertPatientAccess(note.patientId.toString(), actor);

  if (actor.role !== "admin" && note.createdBy.toString() !== actor.id) {
    throw new ApiError(403, "You can only modify your own notes");
  }

  return note;
}

export const patientNotesService = {
  async list(patientId: string, actor: AuthUser, limit: number): Promise<IPatientNoteDocument[]> {
    await assertPatientAccess(patientId, actor);

    return PatientNoteModel.find({
      patientId: new Types.ObjectId(patientId),
      deletedAt: { $exists: false },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("createdBy", "name role");
  },

  async create(patientId: string, actor: AuthUser, content: string): Promise<IPatientNoteDocument> {
    await assertPatientAccess(patientId, actor);

    return PatientNoteModel.create({
      patientId: new Types.ObjectId(patientId),
      content,
      createdBy: new Types.ObjectId(actor.id),
      createdByRole: actor.role,
    });
  },

  async update(noteId: string, actor: AuthUser, content: string, patientId?: string): Promise<IPatientNoteDocument> {
    const note = await getEditableNote(noteId, actor, patientId);
    note.content = content;
    note.updatedBy = new Types.ObjectId(actor.id);
    await note.save();
    return note;
  },

  async softDelete(noteId: string, actor: AuthUser, patientId?: string): Promise<IPatientNoteDocument> {
    const note = await getEditableNote(noteId, actor, patientId);
    note.deletedAt = new Date();
    note.deletedBy = new Types.ObjectId(actor.id);
    await note.save();
    return note;
  },
};
