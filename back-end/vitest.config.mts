import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// The Docker MongoDB port can be overridden per machine through MONGO_PORT in the repo-root
// .env (see docker-compose.yml); reuse it so `npm test` works without extra setup.
function dockerMongoPort(): string {
  const rootEnv = path.resolve(import.meta.dirname, "..", ".env");
  if (existsSync(rootEnv)) {
    const match = readFileSync(rootEnv, "utf8").match(/^MONGO_PORT=(\d+)/m);
    if (match) {
      return match[1];
    }
  }
  return "27017";
}

const testMongoUri =
  process.env.TEST_MONGODB_URI ?? `mongodb://127.0.0.1:${dockerMongoPort()}/mediassist_test`;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Set before any app module loads: dotenv never overrides existing variables, so the
    // real back-end/.env (with live API keys) cannot leak into tests.
    env: {
      NODE_ENV: "test",
      MONGODB_URI: testMongoUri,
      CORS_ORIGIN: "http://localhost:3000",
      APP_TIMEZONE: "Africa/Casablanca",
      JWT_ACCESS_SECRET: "test-access-secret-0123456789",
      JWT_REFRESH_SECRET: "test-refresh-secret-0123456789",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_EXPIRES_IN: "7d",
      BOOTSTRAP_ADMIN_KEY: "test-bootstrap-key",
      GEMINI_API_KEY: "test-gemini-key",
      GROQ_API_KEY: "test-groq-key",
      QDRANT_URL: "http://127.0.0.1:65535",
      QDRANT_API_KEY: "",
      QDRANT_COLLECTION: "test_collection",
      DNS_SERVERS: "",
    },
  },
});
