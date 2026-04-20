import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("Africa/Casablanca"),
  DEFAULT_APPOINTMENT_DURATION_MINUTES: z.coerce.number().int().positive().default(45),
  MAX_APPOINTMENT_DURATION_MINUTES: z.coerce.number().int().positive().default(720),
  LLM_RETRIES_PER_PROVIDER: z.coerce.number().int().min(1).max(5).default(2),
  LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).max(5000).default(250),
  AGENT_IDEMPOTENCY_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(1440),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BOOTSTRAP_ADMIN_KEY: z.string().min(8, "BOOTSTRAP_ADMIN_KEY must be at least 8 chars"),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),

  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

  QDRANT_URL: z.string().url("QDRANT_URL must be a valid URL"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default("medical_records"),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(768),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const flattened = parsedEnv.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(flattened)}`);
}

export const env = parsedEnv.data;

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);