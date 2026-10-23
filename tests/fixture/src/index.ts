import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { createProbe } from "./server/probe";
import { createStreams } from "./server/stream";
import app from "express/rsc/bundle";

const server = express();
const services = { probe: createProbe(), streams: createStreams() };

server.use((req, res, next) => {
  if (import.meta.env.PROD) {
    res.locals.nonce = randomBytes(18).toString("base64");
    res.set(
      "Content-Security-Policy",
      `script-src 'nonce-${res.locals.nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'self'`,
    );
  }

  res.locals.services = services;
  res.locals.user = { id: String(req.headers["x-user"] ?? "guest") };
  res.locals.requestId = req.get("x-request-id") ?? randomUUID();
  res.locals.order = ["global"];
  next();
});
server.use(express.json());
server.use("/", app);
server.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => res.status(500).json({ error: error.message }),
);

const listener = server.listen(Number(process.env.PORT ?? 3000), () =>
  console.log(
    "Express listening on " + (listener.address() as { port: number }).port,
  ),
);
