import { static as serveStatic, type RequestHandler } from "express";
import { fileURLToPath } from "node:url";
import { clientDirectory } from "virtual:express/rsc/config";

interface DevBridge {
  middleware: RequestHandler;
}

const dev = (
  globalThis as typeof globalThis & { [key: symbol]: DevBridge | undefined }
)[Symbol.for("express/rsc.dev")];

/** Serve Vite's development assets, or the browser files emitted by the build. */
const assets: RequestHandler = dev
  ? (req, res, next) =>
      req.method === "GET" || req.method === "HEAD"
        ? dev.middleware(req, res, next)
        : next()
  : serveStatic(fileURLToPath(new URL(clientDirectory, import.meta.url)), {
      index: false,
    });

/**
 * The Express handler for the configured route directory. The router module is
 * imported per request so development updates replace it without a restart.
 */
const app: RequestHandler = (req, res, next) => {
  assets(req, res, async (error?: unknown) => {
    if (error) {
      next(error);

      return;
    }

    try {
      const { default: router } = await import("virtual:express/rsc/router");

      router(req, res, next);
    } catch (error) {
      next(error);
    }
  });
};

export default app;
