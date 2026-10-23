import type { RequestHandler } from "express";

/** Record middleware that belongs only to this download endpoint. */
export const middlewares: RequestHandler = (_req, res, next) => {
  res.locals.order.push("endpoint");
  next();
};

/** Return a native response protected by the ancestor layout middleware. */
export const GET: RequestHandler = (req, res) => {
  res.json({ download: true, params: req.params, order: res.locals.order });
};
