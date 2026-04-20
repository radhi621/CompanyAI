import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { agentController } from "./agent.controller";

export const agentRoutes = Router();

agentRoutes.use(authenticate, authorize("admin", "doctor", "nurse", "secretary"));

agentRoutes.get("/history", agentController.history);
agentRoutes.post("/execute", agentController.execute);
agentRoutes.post("/actions/:actionId/confirm", agentController.confirm);