import type { Request, Response } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import {
  bootstrapAdmin,
  createUser,
  getCurrentUser,
  login,
  logout,
  rotateRefreshToken,
} from "./auth.service";
import {
  bootstrapAdminSchema,
  createUserSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from "./auth.validation";

const refreshCookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: refreshCookieMaxAgeMs,
  path: "/api/v1/auth",
};

export const authController = {
  bootstrapAdmin: asyncHandler(async (req: Request, res: Response) => {
    const parsed = bootstrapAdminSchema.parse({ body: req.body });
    const user = await bootstrapAdmin(parsed.body);

    res.status(201).json({
      message: "Admin user bootstrapped successfully",
      data: user,
    });
  }),

  registerUser: asyncHandler(async (req: Request, res: Response) => {
    const parsed = createUserSchema.parse({ body: req.body });
    const user = await createUser(parsed.body);

    res.status(201).json({
      message: "User created successfully",
      data: user,
    });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.parse({ body: req.body });
    const result = await login(parsed.body, req.get("user-agent"), req.ip);

    res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
    res.status(200).json({
      message: "Login successful",
      data: result,
    });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const parsed = refreshSchema.parse({ body: req.body ?? {} });
    const token = parsed.body.refreshToken ?? req.cookies.refreshToken;

    if (!token) {
      throw new ApiError(401, "Refresh token is required");
    }

    const result = await rotateRefreshToken(token, req.get("user-agent"), req.ip);
    res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);

    res.status(200).json({
      message: "Token refreshed successfully",
      data: result,
    });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const parsed = logoutSchema.parse({ body: req.body ?? {} });
    const token = parsed.body.refreshToken ?? req.cookies.refreshToken;

    if (token) {
      await logout(token);
    }

    res.clearCookie("refreshToken", {
      ...refreshCookieOptions,
      maxAge: undefined,
    });

    res.status(200).json({
      message: "Logout successful",
    });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const user = await getCurrentUser(req.user.id);
    res.status(200).json({
      message: "Current user profile",
      data: user,
    });
  }),
};