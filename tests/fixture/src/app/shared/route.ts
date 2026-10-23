import type { RequestHandler } from "express";

/** Handle a mutation at the same URL as the GET page. */
export const POST: RequestHandler = (req, res) => {
  res.status(201).json({ shared: true, body: req.body });
};
