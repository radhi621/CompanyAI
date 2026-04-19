import { Schema, Types, model, type Document } from "mongoose";

export interface IPatientDocument extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  cin: string;
  phone?: string;
  email?: string;
  dateOfBirth?: Date;
  pathologies: string[];
  assignedStaff: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const patientSchema = new Schema<IPatientDocument>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    cin: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    dateOfBirth: {
      type: Date,
    },
    pathologies: [
      {
        type: String,
        trim: true,
      },
    ],
    assignedStaff: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

patientSchema.index({ lastName: 1, firstName: 1 });
patientSchema.index({ pathologies: 1 });

export const PatientModel = model<IPatientDocument>("Patient", patientSchema);