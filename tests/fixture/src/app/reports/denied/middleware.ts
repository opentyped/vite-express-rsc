import type { RequestHandler } from "express";

/** Deny the request before its page or child endpoint can run. */
const middleware: RequestHandler = (_req, res) => {
  res.status(403).json({ error: "Access denied" });
};

export default middleware;
