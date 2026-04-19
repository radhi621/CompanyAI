import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { appointmentsService } from "./appointments.service";
import {
  appointmentIdSchema,
  createAppointmentSchema,
  listAppointmentsSchema,
  updateAppointmentSchema,
} from "./appointments.validation";

export const appointmentsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = createAppointmentSchema.parse({ body: req.body });
    const appointment = await appointmentsService.create({
      actor: req.user,
      ...parsed.body,
    });

    res.status(201).json({
      message: "Appointment created successfully",
      data: appointment,
    });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = listAppointmentsSchema.parse({ query: req.query });
    const appointments = await appointmentsService.list({
      actor: req.user,
      ...parsed.query,
    });

    res.status(200).json({
      message: "Appointments fetched successfully",
      data: appointments,
    });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = appointmentIdSchema.parse({ params: req.params });
    const appointment = await appointmentsService.getById(parsed.params.appointmentId, req.user);

    res.status(200).json({
      message: "Appointment fetched successfully",
      data: appointment,
    });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = updateAppointmentSchema.parse({ params: req.params, body: req.body });
    const appointment = await appointmentsService.update({
      actor: req.user,
      appointmentId: parsed.params.appointmentId,
      ...parsed.body,
    });

    res.status(200).json({
      message: "Appointment updated successfully",
      data: appointment,
    });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = appointmentIdSchema.parse({ params: req.params });
    await appointmentsService.softDelete(parsed.params.appointmentId, req.user);

    res.status(200).json({
      message: "Appointment deleted successfully",
    });
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = appointmentIdSchema.parse({ params: req.params });
    const appointment = await appointmentsService.restore(parsed.params.appointmentId, req.user);

    res.status(200).json({
      message: "Appointment restored successfully",
      data: appointment,
    });
  }),
};