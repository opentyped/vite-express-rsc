import type { RequestHandler } from "express";

export const GET: RequestHandler = (req, res) => {
  res.json({ params: req.params, order: res.locals.order });
};
