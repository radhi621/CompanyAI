import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { aiService } from "./ai.service";
import {
  aiRecordIdSchema,
  generateAIRecordSchema,
  listAIRecordSchema,
  restoreAIRecordSchema,
  uploadAIRecordSchema,
  updateAIRecordSchema,
} from "./ai.validation";

export const aiController = {
  generateRecord: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = generateAIRecordSchema.parse({ body: req.body });
    const record = await aiService.generateRecordFromPrompt({
      actor: req.user,
      patientId: parsed.body.patientId,
      title: parsed.body.title,
      prompt: parsed.body.prompt,
      mode: parsed.body.mode,
    });

    res.status(201).json({
      message: "AI record generated and saved",
      data: record,
    });
  }),

  uploadRecordFiles: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = uploadAIRecordSchema.parse({ body: req.body });
    const files = (req.files ?? []) as Express.Multer.File[];

    if (files.length === 0) {
      throw new ApiError(400, "At least one file is required");
    }

    const record = await aiService.generateRecordFromFiles({
      actor: req.user,
      patientId: parsed.body.patientId,
      title: parsed.body.title,
      prompt: parsed.body.prompt,
      mode: parsed.body.mode,
      files,
    });

    res.status(201).json({
      message: "AI record generated from uploaded files",
      data: record,
    });
  }),

  listRecords: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = listAIRecordSchema.parse({ query: req.query });
    const records = await aiService.listRecords({
      actor: req.user,
      patientId: parsed.query.patientId,
      mode: parsed.query.mode,
      includeDeleted: parsed.query.includeDeleted,
      limit: parsed.query.limit,
    });

    res.status(200).json({
      message: "AI records fetched successfully",
      data: records,
    });
  }),

  getRecordById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = aiRecordIdSchema.parse({ params: req.params });
    const record = await aiService.getRecordById(parsed.params.recordId, req.user);

    res.status(200).json({
      message: "AI record fetched successfully",
      data: record,
    });
  }),

  updateRecord: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    if (!req.aiRecord) {
      throw new ApiError(404, "AI record not found");
    }

    const parsed = updateAIRecordSchema.parse({ params: req.params, body: req.body });
    const updated = await aiService.updateRecord({
      actor: req.user,
      record: req.aiRecord,
      title: parsed.body.title,
      response: parsed.body.response,
    });

    res.status(200).json({
      message: "AI record updated successfully",
      data: updated,
    });
  }),

  deleteRecord: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    if (!req.aiRecord) {
      throw new ApiError(404, "AI record not found");
    }

    await aiService.deleteRecord(req.aiRecord, req.user);
    res.status(200).json({
      message: "AI record deleted successfully",
    });
  }),

  restoreRecord: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = restoreAIRecordSchema.parse({ params: req.params });
    const restored = await aiService.restoreRecord(parsed.params.recordId, req.user);

    res.status(200).json({
      message: "AI record restored successfully",
      data: restored,
    });
  }),
};