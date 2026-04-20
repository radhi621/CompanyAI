import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../../config/env";

export const qdrantClient = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY,
  checkCompatibility: false,
});

let isCollectionReady = false;

const REQUIRED_PAYLOAD_INDEXES = [
  { fieldName: "patientId", fieldSchema: "keyword" as const },
  { fieldName: "recordId", fieldSchema: "keyword" as const },
];

function collectionExistsFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "object" && value !== null && "exists" in value) {
    return Boolean((value as { exists?: unknown }).exists);
  }

  return false;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
}

function isAlreadyExistsError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("already exists");
}

async function ensurePayloadIndexes(): Promise<void> {
  for (const index of REQUIRED_PAYLOAD_INDEXES) {
    try {
      await qdrantClient.createPayloadIndex(env.QDRANT_COLLECTION, {
        field_name: index.fieldName,
        field_schema: index.fieldSchema,
        wait: true,
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }
}

export const ensureQdrantCollection = async (): Promise<void> => {
  if (isCollectionReady) {
    return;
  }

  const exists = collectionExistsFlag(await qdrantClient.collectionExists(env.QDRANT_COLLECTION));
  if (!exists) {
    try {
      await qdrantClient.createCollection(env.QDRANT_COLLECTION, {
        vectors: {
          size: env.QDRANT_VECTOR_SIZE,
          distance: "Cosine",
        },
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  await ensurePayloadIndexes();

  isCollectionReady = true;
};