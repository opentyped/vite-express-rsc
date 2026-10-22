import type { RequestHandler } from "express";
import { probe } from "../../../server/probe";

export const GET: RequestHandler = (_req, res) => {
  res.json(probe);
};

export const POST: RequestHandler = (_req, res) => {
  for (const key of Object.keys(probe) as (keyof typeof probe)[]) {
    probe[key] = 0;
  }

  res.sendStatus(204);
};
