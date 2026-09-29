import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.LOG_PRETTY === "1" || (process.env.NODE_ENV !== "production" && process.stdout.isTTY);

export const logger = pino({
  level,
  base: { service: "memecoin-engine" },
  redact: {
    // Never log secrets even if a caller passes a whole config object.
    paths: ["*.apiKey", "*.token", "*.botToken", "*.password", "*.DATABASE_URL", "*.url.password", "*.webhookUrl"],
    censor: "[REDACTED]",
  },
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
});

export type Logger = typeof logger;
