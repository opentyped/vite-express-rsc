import type { RequestHandler } from "express";

export const middlewares: RequestHandler = (_req, res, next) => {
  res.locals.order.push("route");
  next();
};

export const GET: RequestHandler = (req, res) => {
  res.json({ id: req.params.id, order: res.locals.order });
};

export const DELETE: RequestHandler = (_req, res) => {
  res.sendStatus(204);
};

export const POST: RequestHandler = (req, res) => {
  res.status(201).json(req.body);
};
