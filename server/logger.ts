import pino from "pino";

const redactPaths = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "password",
  "req.body.password",
  "req.body.token",
  "req.body.apiKey",
  "token",
  "api_key",
  "apiKey",
  "secret",
  "SESSION_SECRET",
  "JWT_SECRET",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: redactPaths,
    remove: true,
  },
});
