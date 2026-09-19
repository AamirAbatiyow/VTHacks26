type LogLevel = "info" | "warn" | "error" | "debug";

const TAGS = [
  "SESSION",
  "SCRIBE",
  "USER",
  "GEMINI",
  "TTS",
  "ELEVENLABS",
  "PLAYBACK",
  "AUDIO",
  "WS",
  "ERROR",
] as const;

export type LogTag = (typeof TAGS)[number] | string;

function redact(message: string): string {
  return message
    .replace(/([A-Za-z0-9_-]{20,})/g, (match) => {
      // Avoid redacting ordinary words; only long token-like strings that look like keys.
      if (/api[_-]?key/i.test(message) || /Bearer\s/i.test(message)) {
        return `${match.slice(0, 4)}…[redacted]`;
      }
      return match;
    })
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]")
    .replace(/(xi-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]");
}

function write(level: LogLevel, tag: LogTag, message: string, extra?: unknown): void {
  const line = `[${tag}] ${redact(message)}`;
  if (extra !== undefined) {
    const safe =
      typeof extra === "string" ? redact(extra) : redact(JSON.stringify(extra));
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](line, safe);
  } else {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](line);
  }
}

export const logger = {
  info(tag: LogTag, message: string, extra?: unknown) {
    write("info", tag, message, extra);
  },
  warn(tag: LogTag, message: string, extra?: unknown) {
    write("warn", tag, message, extra);
  },
  error(tag: LogTag, message: string, extra?: unknown) {
    write("error", tag, message, extra);
  },
  debug(tag: LogTag, message: string, extra?: unknown) {
    if (process.env.DEBUG) write("debug", tag, message, extra);
  },
};
