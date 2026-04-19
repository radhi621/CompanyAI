import { promises as fs } from "fs";
import os from "os";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";
import { ApiError } from "../../utils/apiError";

export interface ParsedDocument {
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  text: string;
}

const MAX_PARSED_TEXT_CHARS = 180_000;

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".txt",
  ".csv",
  ".xls",
  ".xlsx",
  ".doc",
  ".docx",
]);

const SUPPORTED_MIME_TYPES = new Set([
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

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function detectExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

function assertSupportedFormat(fileName: string, mimeType: string): string {
  const extension = detectExtension(fileName);

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ApiError(400, `Unsupported file extension: ${extension || "unknown"}`);
  }

  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new ApiError(400, `Unsupported file MIME type: ${mimeType || "unknown"}`);
  }

  return extension;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    return parsed.text ?? "";
  } finally {
    await parser.destroy();
  }
}

function parseExcel(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const cleanedRows = rows.trim();
    if (!cleanedRows) {
      continue;
    }

    sections.push(`Sheet: ${sheetName}\n${cleanedRows}`);
  }

  return sections.join("\n\n");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function parseDoc(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  const tempPath = path.join(os.tmpdir(), `mediassist-${Date.now()}-${Math.random()}.doc`);

  try {
    await fs.writeFile(tempPath, buffer);
    const extracted = await extractor.extract(tempPath);
    return extracted.getBody() ?? "";
  } finally {
    void fs.unlink(tempPath).catch(() => {
      return;
    });
  }
}

function parseTextLike(buffer: Buffer): string {
  return buffer.toString("utf8");
}

async function parseByExtension(extension: string, buffer: Buffer): Promise<string> {
  switch (extension) {
    case ".pdf":
      return parsePdf(buffer);
    case ".xlsx":
    case ".xls":
      return parseExcel(buffer);
    case ".docx":
      return parseDocx(buffer);
    case ".doc":
      return parseDoc(buffer);
    case ".txt":
    case ".csv":
      return parseTextLike(buffer);
    default:
      throw new ApiError(400, `File format ${extension} is not supported`);
  }
}

export const parseUploadedDocuments = async (
  files: Express.Multer.File[],
): Promise<ParsedDocument[]> => {
  if (files.length === 0) {
    throw new ApiError(400, "At least one file is required");
  }

  const parsedDocuments: ParsedDocument[] = [];

  for (const file of files) {
    const extension = assertSupportedFormat(file.originalname, file.mimetype);
    const parsedText = await parseByExtension(extension, file.buffer);
    const normalized = normalizeText(parsedText);

    if (!normalized) {
      continue;
    }

    parsedDocuments.push({
      fileName: file.originalname,
      extension,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      text: truncateText(normalized, MAX_PARSED_TEXT_CHARS),
    });
  }

  if (parsedDocuments.length === 0) {
    throw new ApiError(400, "Unable to extract text from uploaded files");
  }

  return parsedDocuments;
};
