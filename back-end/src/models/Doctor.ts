import { Schema, Types, model, type Document } from "mongoose";

export interface IDoctorDocument extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  fullName: string;
  specialty: string;
  licenseNumber?: string;
  isActive: boolean;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const doctorSchema = new Schema<IDoctorDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    specialty: {
      type: String,
      required: true,
      trim: true,
    },
    licenseNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

doctorSchema.index({ fullName: 1 });
doctorSchema.index({ specialty: 1 });

export const DoctorModel = model<IDoctorDocument>("Doctor", doctorSchema);