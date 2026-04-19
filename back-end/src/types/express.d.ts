import type { IAIRecordDocument } from "../models/AIRecord";
import type { IPatientDocument } from "../models/Patient";
import type { AuthUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      aiRecord?: IAIRecordDocument;
      patient?: IPatientDocument;
    }
  }
}

export {};