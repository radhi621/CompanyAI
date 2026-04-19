import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { appointmentsController } from "./appointments.controller";

export const appointmentRoutes = Router();

appointmentRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

appointmentRoutes.post("/", authorize("admin", "doctor", "secretary"), appointmentsController.create);
appointmentRoutes.get("/", appointmentsController.list);
appointmentRoutes.get("/:appointmentId", appointmentsController.getById);
appointmentRoutes.patch(
  "/:appointmentId",
  authorize("admin", "doctor", "secretary"),
  appointmentsController.update,
);
appointmentRoutes.delete(
  "/:appointmentId",
  authorize("admin", "doctor", "secretary"),
  appointmentsController.remove,
);
appointmentRoutes.post("/:appointmentId/restore", authorize("admin"), appointmentsController.restore);