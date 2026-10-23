import type { RequestHandler } from "express";

/** Return the users collection fixture. */
export const GET: RequestHandler = (_req, res) => {
  res.json({ users: ["42"], order: res.locals.order });
};
