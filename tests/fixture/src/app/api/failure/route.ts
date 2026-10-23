import type { RequestHandler } from "express";

/** Throw an endpoint error so Express error handling can be verified. */
export const GET: RequestHandler = async () => {
  throw new Error("Expected API failure");
};
