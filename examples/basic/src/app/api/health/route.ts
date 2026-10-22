import type { RequestHandler } from "express";

export const GET: RequestHandler = (_req, res) => {
  res.json({ order: res.locals.order });
};
