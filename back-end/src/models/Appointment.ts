import { Schema, Types, model, type Document } from "mongoose";
import type { UserRole } from "../types/auth";

export type AppointmentStatus =
  | "planned"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface IAppointmentDocument extends Document {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  estimatedDurationMinutes: number;
  reason: string;
  status: AppointmentStatus;
  notes?: string;
  source: "manual" | "ai";
  createdBy: Types.ObjectId;
  createdByRole: UserRole;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointmentDocument>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    startAt: {
      type: Date,
      required: true,
      index: true,
    },
    endAt: {
      type: Date,
      required: true,
      index: true,
    },
    estimatedDurationMinutes: {
      type: Number,
      required: true,
      min: 5,
      max: 1440,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["planned", "confirmed", "in_progress", "completed", "cancelled", "no_show"],
      default: "planned",
      required: true,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ["manual", "ai"],
      default: "manual",
      required: true,
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

appointmentSchema.index({ doctorId: 1, startAt: 1, endAt: 1, deletedAt: 1 });
appointmentSchema.index({ patientId: 1, startAt: 1, deletedAt: 1 });

export const AppointmentModel = model<IAppointmentDocument>("Appointment", appointmentSchema);