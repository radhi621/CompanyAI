import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { patientNotesService } from "./patientNotes.service";
import { patientsService } from "./patients.service";
import {
  createPatientNoteSchema,
  createPatientSchema,
  listPatientNotesSchema,
  listPatientsSchema,
  patientIdSchema,
  patientNoteIdSchema,
  updatePatientSchema,
  updateAssignmentsSchema,
  updatePatientNoteSchema,
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

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = updatePatientSchema.parse({ params: req.params, body: req.body });
    const patient = await patientsService.update(parsed.params.patientId, parsed.body, req.user);

    res.status(200).json({
      message: "Patient updated successfully",
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

  listNotes: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = listPatientNotesSchema.parse({ params: req.params, query: req.query });
    const notes = await patientNotesService.list(parsed.params.patientId, req.user, parsed.query.limit);

    res.status(200).json({
      message: "Patient notes fetched successfully",
      data: notes,
    });
  }),

  createNote: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = createPatientNoteSchema.parse({ params: req.params, body: req.body });
    const note = await patientNotesService.create(parsed.params.patientId, req.user, parsed.body.content);

    res.status(201).json({
      message: "Patient note created successfully",
      data: note,
    });
  }),

  updateNote: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = updatePatientNoteSchema.parse({ params: req.params, body: req.body });
    const note = await patientNotesService.update(
      parsed.params.noteId,
      req.user,
      parsed.body.content,
      parsed.params.patientId,
    );

    res.status(200).json({
      message: "Patient note updated successfully",
      data: note,
    });
  }),

  deleteNote: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = patientNoteIdSchema.parse({ params: req.params });
    await patientNotesService.softDelete(parsed.params.noteId, req.user, parsed.params.patientId);

    res.status(200).json({
      message: "Patient note deleted successfully",
    });
  }),
};
