import type { RequestHandler } from "express";

/** Return the middleware order to show that the endpoint ran. */
export const GET: RequestHandler = (_req, res) => {
  res.json({ order: res.locals.order });
};
