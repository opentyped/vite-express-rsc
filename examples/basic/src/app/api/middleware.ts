import type { RequestHandler } from "express";

/** Inherited by every route under /api. */
const middleware: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

export default middleware;
