import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { patientsController } from "./patients.controller";

export const patientRoutes = Router();

patientRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

patientRoutes.post("/", authorize("admin", "secretary"), patientsController.create);
patientRoutes.get("/", patientsController.list);
patientRoutes.get("/:patientId", patientsController.getById);
patientRoutes.patch("/:patientId", authorize("admin", "secretary"), patientsController.update);
patientRoutes.patch("/:patientId/assignments", authorize("admin"), patientsController.updateAssignments);

// Notes: any role assigned to the patient can read and add; only the author or an admin can edit or delete.
patientRoutes.get("/:patientId/notes", patientsController.listNotes);
patientRoutes.post("/:patientId/notes", patientsController.createNote);
patientRoutes.patch("/:patientId/notes/:noteId", patientsController.updateNote);
patientRoutes.delete("/:patientId/notes/:noteId", patientsController.deleteNote);
