import type { NextFunction, Request, Response } from "express";
import { UserModel } from "../models/User";
import { verifyAccessToken } from "../utils/token";
import { ApiError } from "../utils/apiError";

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    next(new ApiError(401, "Missing Authorization header"));
    return;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    next(new ApiError(401, "Invalid Authorization format"));
    return;
  }

  let decoded: ReturnType<typeof verifyAccessToken>;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    next(new ApiError(401, "Invalid or expired access token"));
    return;
  }

  try {
    // Look the user up on every request so deactivation and role changes apply
    // immediately instead of when the access token expires.
    const user = await UserModel.findById(decoded.sub).select("name email role isActive");
    if (!user || !user.isActive) {
      next(new ApiError(401, "User account is no longer active"));
      return;
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      name: user.name,
    };
    next();
  } catch (error) {
    next(error);
  }
};
