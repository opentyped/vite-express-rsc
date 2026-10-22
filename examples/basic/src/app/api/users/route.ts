import type { RequestHandler } from "express";

export const GET: RequestHandler = (_req, res) => {
  res.json({ users: ["42"], order: res.locals.order });
};
