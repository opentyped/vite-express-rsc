import type { RequestHandler } from "express";
import { getProbe } from "../../../server/probe";

/** Return test counters for loaders, metadata, and rendering. */
export const GET: RequestHandler = (_req, res) => {
  res.json(getProbe());
};

/** Reset the counters before testing whether a guard prevents work. */
export const POST: RequestHandler = (_req, res) => {
  const probe = getProbe();

  for (const key of Object.keys(probe) as (keyof typeof probe)[]) {
    probe[key] = 0;
  }

  res.sendStatus(204);
};
