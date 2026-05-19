import { createApp } from "./server";
import { SERVER_NAME, SERVER_VERSION } from "./constants";
import { logger } from "./services/logger";

async function main() {
  logger.info("startup", `Initializing ${SERVER_NAME} v${SERVER_VERSION}`);

  const app = await createApp();

  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";

  app.listen({ port, hostname: host });

  logger.info("startup", `${SERVER_NAME} v${SERVER_VERSION} is running`, {
    details: {
      mcpEndpoint: `http://${host}:${port}/mcp`,
      healthCheck: `http://${host}:${port}/health`,
      serverInfo: `http://${host}:${port}/`,
    },
  });

  const shutdown = () => {
    logger.info("startup", "Shutting down MCP server");
    app.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  logger.error("startup", "Fatal error during startup", {
    details: { error: error instanceof Error ? error.message : String(error) },
  });
  process.exit(1);
});
