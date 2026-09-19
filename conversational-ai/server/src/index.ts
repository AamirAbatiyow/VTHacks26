import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { GeminiClient } from "./services/gemini.js";
import { VoiceSession } from "./websocket/session.js";
import { StutterClassifier } from "./analysis/StutterClassifier.js";

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
  const stutter = new StutterClassifier(config.stutterModelPath);

  const app = express();
  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      geminiModel: gemini.getModel(),
      elevenLabsModel: config.elevenLabsModelId,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    try {
      const session = new VoiceSession(ws, config, gemini, stutter);
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

  const shutdown = () => {
    logger.info("SESSION", "shutting down");
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("SESSION", "fatal", String(err));
  process.exit(1);
});
