import { Schema, Types, model, type Document } from "mongoose";

export interface IWeeklyAvailability {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface IUnavailableBlock {
  startAt: Date;
  endAt: Date;
  reason?: string;
}

export interface IDoctorScheduleDocument extends Document {
  _id: Types.ObjectId;
  doctorId: Types.ObjectId;
  timezone: string;
  slotStepMinutes: number;
  weeklyAvailability: IWeeklyAvailability[];
  unavailableBlocks: IUnavailableBlock[];
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const weeklyAvailabilitySchema = new Schema<IWeeklyAvailability>(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
  },
  {
    _id: false,
  },
);

const unavailableBlockSchema = new Schema<IUnavailableBlock>(
  {
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

const doctorScheduleSchema = new Schema<IDoctorScheduleDocument>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      unique: true,
      index: true,
    },
    timezone: {
      type: String,
      required: true,
    },
    slotStepMinutes: {
      type: Number,
      required: true,
      default: 15,
      min: 5,
      max: 120,
    },
    weeklyAvailability: {
      type: [weeklyAvailabilitySchema],
      default: [],
    },
    unavailableBlocks: {
      type: [unavailableBlockSchema],
      default: [],
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

export const DoctorScheduleModel = model<IDoctorScheduleDocument>(
  "DoctorSchedule",
  doctorScheduleSchema,
);