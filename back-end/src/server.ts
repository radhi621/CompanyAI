import { app } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env } from "./config/env";
import { setServers } from "node:dns/promises";
setServers(["1.1.1.1", "8.8.8.8"]); 
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