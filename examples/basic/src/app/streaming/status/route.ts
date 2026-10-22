import type { RequestHandler } from "express";
import { streams } from "../../../server/stream";

export const GET: RequestHandler = (_req, res) => res.json(streams);
