import { Types } from "mongoose";
import type { NextFunction, Request, Response } from "express";
import { PatientModel } from "../models/Patient";
import { ApiError } from "../utils/apiError";

function isAssignedToPatient(assignedStaff: Types.ObjectId[], userId: string): boolean {
  return assignedStaff.some((staffId) => staffId.toString() === userId);
}

export const ensureAssignedPatientAccessByParam = (paramName = "patientId") => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new ApiError(401, "Authentication is required");
      }

      const rawPatientId = req.params[paramName];
      const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : rawPatientId;
      if (!patientId || !Types.ObjectId.isValid(patientId)) {
        throw new ApiError(400, "Invalid patient ID");
      }

      const patient = await PatientModel.findById(patientId).select("assignedStaff");
      if (!patient) {
        throw new ApiError(404, "Patient not found");
      }

      if (req.user.role !== "admin" && !isAssignedToPatient(patient.assignedStaff, req.user.id)) {
        throw new ApiError(403, "You are not assigned to this patient");
      }

      req.patient = patient;
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const ensureAssignedPatientAccessByBody = (fieldName = "patientId") => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new ApiError(401, "Authentication is required");
      }

      const patientId = req.body?.[fieldName] as string | undefined;
      if (!patientId || !Types.ObjectId.isValid(patientId)) {
        throw new ApiError(400, "Invalid patient ID");
      }

      const patient = await PatientModel.findById(patientId).select("assignedStaff");
      if (!patient) {
        throw new ApiError(404, "Patient not found");
      }

      if (req.user.role !== "admin" && !isAssignedToPatient(patient.assignedStaff, req.user.id)) {
        throw new ApiError(403, "You are not assigned to this patient");
      }

      req.patient = patient;
      next();
    } catch (error) {
      next(error);
    }
  };
};