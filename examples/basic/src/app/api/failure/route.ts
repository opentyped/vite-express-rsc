import type { RequestHandler } from "express";

export const GET: RequestHandler = async () => {
  throw new Error("Expected API failure");
};
