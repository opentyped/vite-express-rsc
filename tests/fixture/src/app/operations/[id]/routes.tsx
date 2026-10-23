import type { RequestHandler } from "express";

export const middlewares: RequestHandler[] = [
  (_req, res, next) => {
    res.locals.order.push("module");
    next();
  },
];

/** Return the operation after module and method middleware have run. */
export const GET: RequestHandler<
  { id: string },
  { id: string; order: string[]; operationId?: string }
> = (req, res) => {
  res.json({
    id: req.params.id,
    order: res.locals.order,
    operationId: GET.openapi?.operationId,
  });
};

GET.openapi = {
  operationId: "getOperation",
  description: "Return an operation after method-specific middleware.",
  responses: { "200": { description: "The operation" } },
};
GET.middlewares = [
  (_req, res, next) => {
    res.locals.order.push("get");
    res.set("X-Method-Guard", "get");
    next();
  },
];

/** Demonstrate a handler that its method middleware prevents from running. */
export const POST: RequestHandler = (_req, res) => res.sendStatus(201);

POST.middlewares = [
  (_req, res) => res.status(403).json({ error: "Blocked by POST middleware" }),
];
