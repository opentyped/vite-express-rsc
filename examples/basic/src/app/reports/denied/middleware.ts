import type { RequestHandler } from "express";

const middleware: RequestHandler = (_req, res) => {
  res.status(403).json({ error: "Access denied" });
};

export default middleware;
