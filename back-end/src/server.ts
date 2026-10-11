import { app } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env } from "./config/env";
import { setServers } from "node:dns/promises";

// Optional DNS override (e.g. when the local resolver cannot answer MongoDB Atlas SRV lookups).
if (env.DNS_SERVERS.length > 0) {
  setServers(env.DNS_SERVERS);
}

async function startServer(): Promise<void> {
  await connectDatabase();

  const server = app.listen(env.PORT, () => {
    console.log(`MediAssist backend running on port ${env.PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});