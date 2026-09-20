import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/stutter-models": {
        target: "http://localhost:3001",
      },
      "/health": {
        target: "http://localhost:3001",
      },
      "/exercise-recommendations": {
        target: "http://localhost:3001",
      },
      "/conversation-tips": {
        target: "http://localhost:3001",
      },
      "/report-narrative": {
        target: "http://localhost:3001",
      },
    },
  },
});
