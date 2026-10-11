import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { usersController } from "./users.controller";

export const userRoutes = Router();

userRoutes.use(authenticate, authorize("admin"));

userRoutes.get("/", usersController.list);
userRoutes.patch("/:userId", usersController.update);
userRoutes.post("/:userId/reset-password", usersController.resetPassword);
