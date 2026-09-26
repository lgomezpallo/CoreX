import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/health", async (_req, res): Promise<void> => {
  try {
    await pool.query("select 1");
    res.json({ status: "ok", database: "ok" });
  } catch {
    logger.error("Database health check failed");
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

const staticDirectory = process.env.STATIC_DIR?.trim();
if (staticDirectory) {
  const publicDirectory = path.resolve(staticDirectory);
  app.use(express.static(publicDirectory, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (/^\/(?:api|health(?:z)?)(?:\/|$)/.test(req.path)) {
      next();
      return;
    }
    res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;
