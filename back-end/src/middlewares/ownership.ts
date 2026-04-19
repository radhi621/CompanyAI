import { Types } from "mongoose";
import type { NextFunction, Request, Response } from "express";
import { isHigherRole } from "../constants/roles";
import { AIRecordModel } from "../models/AIRecord";
import { PatientModel } from "../models/Patient";
import { ApiError } from "../utils/apiError";

export const ensureAIRecordOwnerOrHigher = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const rawRecordId = req.params.recordId;
    const recordId = Array.isArray(rawRecordId) ? rawRecordId[0] : rawRecordId;
    if (!recordId || !Types.ObjectId.isValid(recordId)) {
      throw new ApiError(400, "Invalid AI record ID");
    }

    const record = await AIRecordModel.findOne({
      _id: recordId,
      deletedAt: { $exists: false },
    });
    if (!record) {
      throw new ApiError(404, "AI record not found");
    }

    if (req.user.role !== "admin") {
      const assigned = await PatientModel.exists({
        _id: record.patientId,
        assignedStaff: new Types.ObjectId(req.user.id),
      });

      if (!assigned) {
        throw new ApiError(403, "You are not assigned to this patient");
      }
    }

    const isOwner = record.createdBy.toString() === req.user.id;
    const canOverride = isHigherRole(req.user.role, record.createdByRole);
    if (!isOwner && !canOverride) {
      throw new ApiError(403, "Only the owner or a higher role can modify this record");
    }

    req.aiRecord = record;
    next();
  } catch (error) {
    next(error);
  }
};