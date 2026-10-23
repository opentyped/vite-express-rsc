import type { RequestHandler } from "express";
import { getRequestContext } from "express/rsc/context";

/** Mark responses to show that root middleware runs for the whole tree. */
const middleware: RequestHandler = (_req, res, next) => {
  res.set("X-Root-Middleware", "yes");
  res.set("X-Context-Request", getRequestContext().locals.requestId);
  next();
};

export default middleware;
