import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import { usersService } from "./users.service";
import { listUsersSchema, resetPasswordSchema, updateUserSchema } from "./users.validation";

export const usersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const parsed = listUsersSchema.parse({ query: req.query });
    const users = await usersService.list(parsed.query);

    res.status(200).json({
      message: "Users fetched successfully",
      data: users,
    });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication is required");
    }

    const parsed = updateUserSchema.parse({ params: req.params, body: req.body });
    const user = await usersService.update({
      actor: req.user,
      userId: parsed.params.userId,
      ...parsed.body,
    });

    res.status(200).json({
      message: "User updated successfully",
      data: user,
    });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const parsed = resetPasswordSchema.parse({ params: req.params, body: req.body });
    const user = await usersService.resetPassword(parsed.params.userId, parsed.body.newPassword);

    res.status(200).json({
      message: "Password reset. The user has been signed out of all sessions.",
      data: user,
    });
  }),
};
