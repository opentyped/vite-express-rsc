import type { RequestHandler } from "express";

/** Record middleware inherited by the protected subtree. */
const middleware: RequestHandler = (_req, res, next) => {
  res.locals.order.push("directory");
  next();
};

export default middleware;
