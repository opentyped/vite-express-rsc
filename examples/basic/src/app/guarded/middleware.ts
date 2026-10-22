import type { RequestHandler } from "express";

const middleware: RequestHandler = (_req, res, next) => {
  res.locals.order.push("directory");
  next();
};

export default middleware;
