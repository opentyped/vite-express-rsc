import type { RequestHandler } from "express";

/** Record middleware inherited by every endpoint in the users subtree. */
const middleware: RequestHandler = (_req, res, next) => {
  res.locals.order.push("users");
  next();
};

export default middleware;
