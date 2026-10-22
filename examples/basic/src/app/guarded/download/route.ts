import type { RequestHandler } from "express";

export const middlewares: RequestHandler = (_req, res, next) => {
  res.locals.order.push("endpoint");
  next();
};

export const GET: RequestHandler = (req, res) => {
  res.json({ download: true, params: req.params, order: res.locals.order });
};
