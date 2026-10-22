import type { RequestHandler } from "express";

export const POST: RequestHandler = (req, res) => {
  res.status(201).json({ shared: true, body: req.body });
};
