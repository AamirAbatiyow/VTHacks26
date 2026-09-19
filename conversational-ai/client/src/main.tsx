import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// StrictMode omitted: double-mounting would open two mic/WebSocket sessions.
createRoot(document.getElementById("root")!).render(<App />);
