import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { ensureAssignedPatientAccessByBody } from "../../middlewares/patientAccess";
import { ensureAIRecordOwnerOrHigher } from "../../middlewares/ownership";
import { aiRecordUpload } from "../../middlewares/upload";
import { aiController } from "./ai.controller";

export const aiRoutes = Router();

aiRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

aiRoutes.post("/records/generate", ensureAssignedPatientAccessByBody("patientId"), aiController.generateRecord);
aiRoutes.post(
	"/records/upload",
	aiRecordUpload.array("files", 8),
	ensureAssignedPatientAccessByBody("patientId"),
	aiController.uploadRecordFiles,
);
aiRoutes.get("/records", aiController.listRecords);
aiRoutes.get("/records/:recordId", aiController.getRecordById);
aiRoutes.patch("/records/:recordId", ensureAIRecordOwnerOrHigher, aiController.updateRecord);
aiRoutes.delete("/records/:recordId", ensureAIRecordOwnerOrHigher, aiController.deleteRecord);
aiRoutes.post("/records/:recordId/restore", authorize("admin"), aiController.restoreRecord);