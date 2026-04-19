import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { patientsService } from "./patients.service";
import {
  createPatientSchema,
  listPatientsSchema,
  patientIdSchema,
  updateAssignmentsSchema,
} from "./patients.validation";

export const patientsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = createPatientSchema.parse({ body: req.body });
    const patient = await patientsService.create({
      actor: req.user,
      ...parsed.body,
    });

    res.status(201).json({
      message: "Patient created successfully",
      data: patient,
    });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = listPatientsSchema.parse({ query: req.query });
    const patients = await patientsService.list({
      actor: req.user,
      limit: parsed.query.limit,
    });

    res.status(200).json({
      message: "Patients fetched successfully",
      data: patients,
    });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = patientIdSchema.parse({ params: req.params });
    const patient = await patientsService.getById(parsed.params.patientId, req.user);

    res.status(200).json({
      message: "Patient fetched successfully",
      data: patient,
    });
  }),

  updateAssignments: asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateAssignmentsSchema.parse({ params: req.params, body: req.body });
    const patient = await patientsService.updateAssignments(
      parsed.params.patientId,
      parsed.body.assignedStaff,
    );

    res.status(200).json({
      message: "Patient assignments updated successfully",
      data: patient,
    });
  }),
};