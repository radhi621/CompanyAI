import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError";

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(404, "Route not found"));
};

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (error instanceof ZodError) {
    res.status(400).json({
      message: "Validation error",
      issues: error.flatten(),
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      message: error.message,
      details: error.details,
    });
    return;
  }

  if (error instanceof MulterError) {
    res.status(400).json({
      message: `File upload error: ${error.message}`,
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({
      message: `Invalid value for ${error.path}`,
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      message: "Validation error",
      fields: Object.keys(error.errors),
    });
    return;
  }

  // Unique index violations (e.g. a CIN or email that already exists). The raw
  // driver message includes the duplicated value, so only the field names are returned.
  if ((error as { code?: unknown })?.code === 11000) {
    const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
    res.status(409).json({
      message: "A record with the same unique value already exists",
      fields: Object.keys(keyPattern),
    });
    return;
  }

  // Client errors raised by Express middleware, such as malformed JSON or an oversized body.
  const httpError = error as { status?: unknown; expose?: unknown; message?: unknown };
  if (
    typeof httpError?.status === "number" &&
    httpError.status >= 400 &&
    httpError.status < 500 &&
    httpError.expose === true
  ) {
    res.status(httpError.status).json({
      message: typeof httpError.message === "string" ? httpError.message : "Bad request",
    });
    return;
  }

  // Unexpected errors: keep the details in the server log, not in the response.
  console.error(`[${req.method} ${req.originalUrl}] Unhandled error:`, error);
  res.status(500).json({
    message: "Internal server error",
  });
};