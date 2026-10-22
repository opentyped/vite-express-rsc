import type { RequestHandler } from "express";

export const GET: RequestHandler = (_req, res) => {
  res.send("Forbidden raw handler must never run");
};
