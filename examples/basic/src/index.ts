import { randomBytes } from "node:crypto";
import express from "express";
import { appRouter } from "@opentyped/vite-express-rsc/app";

const server = express();

server.use((req, res, next) => {
  if (import.meta.env.PROD) {
    res.locals.nonce = randomBytes(18).toString("base64");
    res.set(
      "Content-Security-Policy",
      `script-src 'nonce-${res.locals.nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'self'`,
    );
  }

  res.locals.user = { id: String(req.headers["x-user"] ?? "guest") };
  res.locals.requestId = req.headers["x-request-id"];
  res.locals.order = ["global"];
  next();
});
server.use(express.json());
server.use("/", appRouter);
server.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => res.status(500).json({ error: error.message }),
);

export const listener = server.listen(Number(process.env.PORT ?? 3000), () =>
  console.log(
    "Express listening on " + (listener.address() as { port: number }).port,
  ),
);
