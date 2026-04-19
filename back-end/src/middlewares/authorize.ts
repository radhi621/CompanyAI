import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../types/auth";
import { ApiError } from "../utils/apiError";

export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, "Authentication is required"));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ApiError(403, "Insufficient role permissions"));
      return;
    }

    next();
  };
};