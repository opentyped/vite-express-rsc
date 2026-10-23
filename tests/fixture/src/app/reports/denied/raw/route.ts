import type { RequestHandler } from "express";

/** Demonstrate a raw endpoint that ancestor middleware must block. */
export const GET: RequestHandler = (_req, res) => {
  res.send("Forbidden raw handler must never run");
};
