import type { RequestHandler } from "express";

/** Record that middleware for this endpoint ran before its handler. */
export const middlewares: RequestHandler = (_req, res, next) => {
  res.locals.order.push("route");
  next();
};

/** Return the user parameter and middleware order. */
export const GET: RequestHandler = (req, res) => {
  res.json({ id: req.params.id, order: res.locals.order });
};

/** Demonstrate a native Express response with no body. */
export const DELETE: RequestHandler = (_req, res) => {
  res.sendStatus(204);
};

/** Echo the parsed request body with a created response. */
export const POST: RequestHandler = (req, res) => {
  res.status(201).json(req.body);
};
