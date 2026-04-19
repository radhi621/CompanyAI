import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { patientsController } from "./patients.controller";

export const patientRoutes = Router();

patientRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

patientRoutes.post("/", authorize("admin", "secretary"), patientsController.create);
patientRoutes.get("/", patientsController.list);
patientRoutes.get("/:patientId", patientsController.getById);
patientRoutes.patch("/:patientId/assignments", authorize("admin"), patientsController.updateAssignments);