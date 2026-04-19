import multer from "multer";
import { ApiError } from "../utils/apiError";

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".csv", ".xls", ".xlsx", ".doc", ".docx"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const aiRecordUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!hasAllowedExtension(file.originalname)) {
      callback(new ApiError(400, `Unsupported file extension for ${file.originalname}`) as unknown as Error);
      return;
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new ApiError(400, `Unsupported MIME type ${file.mimetype} for ${file.originalname}`) as unknown as Error);
      return;
    }

    callback(null, true);
  },
});
