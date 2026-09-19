import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { GeminiClient } from "./services/gemini.js";
import { VoiceSession } from "./websocket/session.js";
import { StutterClassifier } from "./analysis/StutterClassifier.js";
import { AnalyticsTracker } from "./analytics/AnalyticsTracker.js";
import { createAnalyticsPool, postgresAnalyticsDatabase } from "./analytics/database.js";
import { LocalAnalyticsDatabase, localDatabasePath } from "./analytics/local.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error("SESSION", String(err));
    logger.error(
      "SESSION",
      "Create conversational-ai/server/.env from .env.example and set API keys.",
    );
    process.exit(1);
  }

  const model = await GeminiClient.resolveModel(
    config.geminiApiKey,
    config.geminiModelPreference,
  );
  const gemini = new GeminiClient(
    config.geminiApiKey,
    model,
    config.geminiModelPreference,
  );

  // One ONNX session shared by every connection — loading is lazy and cached.
  const stutter = new StutterClassifier(
    config.stutterModelPath,
    config.stutterGatePath,
  );

  const app = express();
  const analyticsPool = config.databaseUrl ? createAnalyticsPool(config.databaseUrl) : null;
  analyticsPool?.on("error", () => logger.warn("ANALYTICS", "Idle database connection failed."));
  const analytics = new AnalyticsTracker(analyticsPool
    ? postgresAnalyticsDatabase(analyticsPool) : new LocalAnalyticsDatabase());
  logger.info("ANALYTICS", analyticsPool ? "PostgreSQL tracking enabled; run db:migrate to initialize." : `Local SQLite tracking: ${localDatabasePath()}`);
  const sessions = new Set<VoiceSession>();
  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      analytics: analytics.status(),
      geminiModel: gemini.getModel(),
      elevenLabsModel: config.elevenLabsModelId,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    try {
      const session = new VoiceSession(ws, config, gemini, stutter, analytics);
      sessions.add(session);
      ws.once("close", () => sessions.delete(session));
      session.attach();
    } catch (err) {
      logger.error("SESSION", "failed to create session", String(err));
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  });

  wss.on("error", (err) => {
    logger.error("WS", "server error", String(err));
  });

  server.listen(config.port, () => {
    logger.info("SESSION", `listening on http://localhost:${config.port}`);
    logger.info("SESSION", `WebSocket at ws://localhost:${config.port}/ws`);
    logger.info("GEMINI", `model=${gemini.getModel()}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("SESSION", "shutting down");
    const deadline = setTimeout(() => process.exit(1), 12000);
    deadline.unref();
    wss.close();
    server.close();
    await Promise.allSettled([...sessions].map((session) => session.cleanup("server_shutdown")));
    await analytics.close();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("SESSION", "fatal", String(err));
  process.exit(1);
});
