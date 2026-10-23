import type { RequestHandler } from "express";

/** Return both nested parameters to verify they survive router mounts. */
export const GET: RequestHandler = (req, res) => {
  res.json({ params: req.params, order: res.locals.order });
};
