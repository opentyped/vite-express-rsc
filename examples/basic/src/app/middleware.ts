import type { RequestHandler } from "express";

const middleware: RequestHandler = (_req, res, next) => {
  res.set("X-Root-Middleware", "yes");
  next();
};

export default middleware;
