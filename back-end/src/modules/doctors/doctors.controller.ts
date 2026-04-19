import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { doctorsService } from "./doctors.service";
import {
  createDoctorSchema,
  doctorIdSchema,
  listDoctorSchema,
  listDoctorSlotsSchema,
  upsertDoctorScheduleSchema,
} from "./doctors.validation";

export const doctorsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = createDoctorSchema.parse({ body: req.body });
    const doctor = await doctorsService.create({
      actor: req.user,
      ...parsed.body,
    });

    res.status(201).json({
      message: "Doctor created successfully",
      data: doctor,
    });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const parsed = listDoctorSchema.parse({ query: req.query });
    const doctors = await doctorsService.list(parsed.query);

    res.status(200).json({
      message: "Doctors fetched successfully",
      data: doctors,
    });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const parsed = doctorIdSchema.parse({ params: req.params });
    const doctor = await doctorsService.getById(parsed.params.doctorId);

    res.status(200).json({
      message: "Doctor fetched successfully",
      data: doctor,
    });
  }),

  upsertSchedule: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = upsertDoctorScheduleSchema.parse({ params: req.params, body: req.body });
    const schedule = await doctorsService.upsertSchedule({
      actor: req.user,
      doctorId: parsed.params.doctorId,
      ...parsed.body,
    });

    res.status(200).json({
      message: "Doctor schedule updated successfully",
      data: schedule,
    });
  }),

  getSchedule: asyncHandler(async (req: Request, res: Response) => {
    const parsed = doctorIdSchema.parse({ params: req.params });
    const schedule = await doctorsService.getSchedule(parsed.params.doctorId);

    res.status(200).json({
      message: "Doctor schedule fetched successfully",
      data: schedule,
    });
  }),

  getSlots: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = listDoctorSlotsSchema.parse({ params: req.params, query: req.query });
    const slots = await doctorsService.getAvailableSlots({
      actor: req.user,
      doctorId: parsed.params.doctorId,
      date: parsed.query.date,
      days: parsed.query.days,
      estimatedDurationMinutes: parsed.query.estimatedDurationMinutes,
    });

    res.status(200).json({
      message: "Available slots fetched successfully",
      data: slots,
    });
  }),
};