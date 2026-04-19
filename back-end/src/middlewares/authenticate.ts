import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/token";
import { ApiError } from "../utils/apiError";

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new ApiError(401, "Missing Authorization header");
    }

    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new ApiError(401, "Invalid Authorization format");
    }

    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired access token"));
  }
};