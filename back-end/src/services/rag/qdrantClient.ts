import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../../config/env";

export const qdrantClient = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY,
  checkCompatibility: false,
});

let isCollectionReady = false;

export const ensureQdrantCollection = async (): Promise<void> => {
  if (isCollectionReady) {
    return;
  }

  const exists = await qdrantClient.collectionExists(env.QDRANT_COLLECTION);
  if (!exists) {
    await qdrantClient.createCollection(env.QDRANT_COLLECTION, {
      vectors: {
        size: env.QDRANT_VECTOR_SIZE,
        distance: "Cosine",
      },
    });
  }

  isCollectionReady = true;
};