import type { RequestHandler } from "express";

const middleware: RequestHandler = (_req, res, next) => {
  res.locals.order.push("users");
  next();
};

export default middleware;
