import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { doctorsController } from "./doctors.controller";

export const doctorRoutes = Router();

doctorRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

doctorRoutes.post("/", authorize("admin"), doctorsController.create);
doctorRoutes.get("/", doctorsController.list);
doctorRoutes.get("/:doctorId", doctorsController.getById);
doctorRoutes.get("/:doctorId/schedule", doctorsController.getSchedule);
doctorRoutes.put("/:doctorId/schedule", authorize("admin", "doctor"), doctorsController.upsertSchedule);
doctorRoutes.get("/:doctorId/slots", doctorsController.getSlots);