import { Schema, Types, model, type Document } from "mongoose";
import type { UserRole } from "../types/auth";

export interface IPatientNoteDocument extends Document {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  content: string;
  createdBy: Types.ObjectId;
  createdByRole: UserRole;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const patientNoteSchema = new Schema<IPatientNoteDocument>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdByRole: {
      type: String,
      enum: ["admin", "doctor", "nurse", "secretary"],
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    deletedAt: {
      type: Date,
      index: true,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

patientNoteSchema.index({ patientId: 1, createdAt: -1, deletedAt: 1 });

export const PatientNoteModel = model<IPatientNoteDocument>("PatientNote", patientNoteSchema);