import path from "node:path";
import { existsSync } from "node:fs";
import { projectRoot } from "./paths.js";
import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { GeminiClient } from "./services/gemini.js";
import { VoiceSession } from "./websocket/session.js";
import { StutterClassifier } from "./analysis/StutterClassifier.js";
import { STUTTER_MODELS } from "./analysis/modelRegistry.js";
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

  // One StutterClassifier per registered model, shared by every connection.
  // Each lazily loads its own ONNX file (and, by filename convention, an
  // optional "<name>_gate.onnx" two-head fluency gate) on first use, so
  // unused variants cost nothing until selected.
  const stutterModels = new Map(
    STUTTER_MODELS.filter(m => existsSync(m.modelPath)).map((m) => [m.id, new StutterClassifier(m.id === "cnn" && process.env.STUTTER_MODEL_PATH ? path.resolve(process.env.STUTTER_MODEL_PATH) : m.modelPath)] as const),
  );
  logger.info(
    "ANALYSIS",
    `stutter models registered: ${STUTTER_MODELS.map((m) => m.id).join(", ")} (default=${config.defaultStutterModelId})`,
  );

  const app = express();
  const analyticsPool = config.databaseUrl ? createAnalyticsPool(config.databaseUrl) : null;
  analyticsPool?.on("error", () => logger.warn("ANALYTICS", "Idle database connection failed."));
  const analytics = new AnalyticsTracker(analyticsPool
    ? postgresAnalyticsDatabase(analyticsPool) : new LocalAnalyticsDatabase());
  logger.info("ANALYTICS", analyticsPool ? "PostgreSQL tracking enabled; run db:migrate to initialize." : `Local SQLite tracking: ${localDatabasePath()}`);
  const sessions = new Set<VoiceSession>();
  app.use(cors());
  app.get("/stutter-models", (_req, res) => {
    res.json({
      models: STUTTER_MODELS.filter(m => stutterModels.has(m.id)).map(({ id, label }) => ({ id, label })),
      defaultId: config.defaultStutterModelId,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      analytics: analytics.status(),
      geminiModel: gemini.getModel(),
      elevenLabsModel: config.elevenLabsModelId,
    });
  });

  // Serve the same built UI and WebSocket origin in production.
  const clientDist = path.join(projectRoot, "client/dist");
  const clientIndex = path.join(clientDist, "index.html");
  if (existsSync(clientIndex)) {
    app.use(express.static(clientDist));
    // React owns client-side routes. Returning index.html for HTML navigation
    // keeps refreshes and direct links on the same Fly app instead of 404ing.
    // API routes above still win, and WebSocket upgrades bypass this handler.
    app.use((req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) {
        next();
        return;
      }
      res.sendFile(clientIndex);
    });
  }
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    try {
      const session = new VoiceSession(ws, config, gemini, stutterModels, analytics);
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
