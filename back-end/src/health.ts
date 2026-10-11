import type { Request, Response } from "express";
import mongoose from "mongoose";
import { qdrantClient } from "./services/rag/qdrantClient";

const CHECK_TIMEOUT_MS = 2000;

type CheckStatus = "up" | "down";

async function withTimeout(check: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
  });

  try {
    await Promise.race([check(), timeout]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<CheckStatus> {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !mongoose.connection.db) {
    return "down";
  }

  const db = mongoose.connection.db;
  return withTimeout(() => db.admin().ping());
}

/**
 * Liveness plus dependency status. MongoDB down means the app cannot work (503). Qdrant down
 * only disables uploaded-file search, so the app reports "degraded" but stays 200.
 */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const [database, vectorStore] = await Promise.all([
    checkDatabase(),
    withTimeout(() => qdrantClient.getCollections()),
  ]);

  const status = database === "down" ? "down" : vectorStore === "down" ? "degraded" : "ok";

  res.status(database === "down" ? 503 : 200).json({
    status,
    service: "mediassist-backend",
    checks: { database, vectorStore },
    timestamp: new Date().toISOString(),
  });
}
