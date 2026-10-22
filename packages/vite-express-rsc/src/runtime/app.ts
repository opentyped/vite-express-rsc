import { Router, static as serveStatic, type RequestHandler } from "express";
import { fileURLToPath } from "node:url";

interface DevBridge {
  middleware: RequestHandler;
}
const dev = (
  globalThis as typeof globalThis & { [key: symbol]: DevBridge | undefined }
)[Symbol.for("express-rsc.dev")];

export const appRouter = Router();

if (dev) {
  appRouter.use((req, res, next) =>
    req.method === "GET" || req.method === "HEAD"
      ? dev.middleware(req, res, next)
      : next(),
  );
} else {
  appRouter.use(
    serveStatic(fileURLToPath(new URL("../client/", import.meta.url)), {
      index: false,
    }),
  );
}

appRouter.use(async (req, res, next) => {
  try {
    const { dispatch } = await import.meta.viteRsc.loadModule<
      typeof import("./rsc.js")
    >("rsc", "index");

    await dispatch(req, res, next);
  } catch (error) {
    if (!res.destroyed) {
      next(error);
    }
  }
});
