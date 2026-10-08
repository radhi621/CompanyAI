import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

// Every test file drops the database it uses, so refuse to touch anything that is not
// clearly a test database.
const uri = process.env.MONGODB_URI ?? "";
const dbName = new URL(uri).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run tests against database "${dbName}": its name must end with "_test".`);
}

beforeAll(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  } catch (error) {
    throw new Error(
      `Cannot reach the test MongoDB at ${uri}. Start it with "docker compose up -d" from the repo root ` +
        `(or set TEST_MONGODB_URI). Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await mongoose.connection.dropDatabase();
  // Unique indexes (CIN, email, token hash) are part of what the tests exercise.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
