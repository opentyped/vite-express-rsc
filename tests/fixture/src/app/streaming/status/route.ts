import type { RequestHandler } from "express";
import { getStreams } from "../../../server/stream";

/** Return streaming counters so completion and cancellation can be checked. */
export const GET: RequestHandler = (_req, res) => res.json(getStreams());
