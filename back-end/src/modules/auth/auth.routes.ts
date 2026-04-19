import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { authController } from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/bootstrap-admin", authController.bootstrapAdmin);
authRoutes.post("/login", authController.login);
authRoutes.post("/refresh", authController.refresh);
authRoutes.post("/logout", authController.logout);
authRoutes.get("/me", authenticate, authController.me);
authRoutes.post("/users", authenticate, authorize("admin"), authController.registerUser);