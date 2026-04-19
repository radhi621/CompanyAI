import { Router } from "express";
import { agentRoutes } from "../modules/agent/agent.routes";
import { aiRoutes } from "../modules/ai/ai.routes";
import { appointmentRoutes } from "../modules/appointments/appointments.routes";
import { authRoutes } from "../modules/auth/auth.routes";
import { doctorRoutes } from "../modules/doctors/doctors.routes";
import { patientRoutes } from "../modules/patients/patients.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/patients", patientRoutes);
apiRouter.use("/doctors", doctorRoutes);
apiRouter.use("/appointments", appointmentRoutes);
apiRouter.use("/ai", aiRoutes);
apiRouter.use("/agent", agentRoutes);