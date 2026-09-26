import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  const forceExit = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    server.closeAllConnections();
    void pool.end().finally(() => process.exit(1));
  }, 8_000);
  forceExit.unref();

  server.close((error) => {
    if (error) {
      logger.error({ err: error, signal }, "HTTP server close failed");
      process.exitCode = 1;
    }
    void pool
      .end()
      .catch((poolError: unknown) => {
        logger.error({ err: poolError }, "Database pool close failed");
        process.exitCode = 1;
      })
      .finally(() => {
        clearTimeout(forceExit);
      });
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
