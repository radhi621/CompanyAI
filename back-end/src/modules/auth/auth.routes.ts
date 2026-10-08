import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import {
  bootstrapAdminRateLimit,
  loginRateLimit,
  refreshRateLimit,
} from "../../middlewares/rateLimit";
import { authController } from "./auth.controller";

export const authRoutes = Router();

authRoutes.get("/setup-status", authController.setupStatus);
authRoutes.post("/bootstrap-admin", bootstrapAdminRateLimit, authController.bootstrapAdmin);
authRoutes.post("/login", loginRateLimit, authController.login);
authRoutes.post("/refresh", refreshRateLimit, authController.refresh);
authRoutes.post("/logout", authController.logout);
authRoutes.get("/me", authenticate, authController.me);
// Failed attempts share the login limiter so this cannot be used to brute-force the current password.
authRoutes.post("/me/password", authenticate, loginRateLimit, authController.changePassword);
authRoutes.post("/users", authenticate, authorize("admin"), authController.registerUser);