import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { llmRouter } from "../src/services/llm/llmRouter";
import { qdrantClient } from "../src/services/rag/qdrantClient";
import { API, api, auth, createSession } from "./helpers";

describe("health check", () => {
  it("reports degraded, not down, when only Qdrant is unreachable", async () => {
    // The test Qdrant URL points at a closed port.
    const res = await api().get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ database: "up", vectorStore: "down" });
  });

  it("reports ok when MongoDB and Qdrant both answer", async () => {
    vi.spyOn(qdrantClient, "getCollections").mockResolvedValue({ collections: [] });

    const res = await api().get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns 503 when the database does not answer", async () => {
    const db = mongoose.connection.db!;
    vi.spyOn(db, "admin").mockReturnValue({ ping: () => Promise.reject(new Error("down")) } as unknown as ReturnType<
      typeof db.admin
    >);

    const res = await api().get("/health");

    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("down");
  });
});

describe("AI rate limits", () => {
  const defaultLimit = env.AGENT_RATE_LIMIT_PER_MINUTE;

  afterEach(() => {
    env.AGENT_RATE_LIMIT_PER_MINUTE = defaultLimit;
  });

  it("limits assistant requests per user, not for everyone", async () => {
    env.AGENT_RATE_LIMIT_PER_MINUTE = 2;
    vi.spyOn(llmRouter, "generate").mockResolvedValue({ provider: "gemini", text: '{"toolCalls":[],"finalMessage":"Hi."}' });
    const busy = await createSession("nurse");
    const other = await createSession("nurse");
    const ask = (session: typeof busy) =>
      api().post(`${API}/agent/execute`).set(auth(session)).send({ prompt: "Hello" });

    expect((await ask(busy)).status).toBe(200);
    expect((await ask(busy)).status).toBe(200);
    const limited = await ask(busy);
    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/Too many assistant requests/);
    expect((await ask(other)).status).toBe(200);
  });
});
