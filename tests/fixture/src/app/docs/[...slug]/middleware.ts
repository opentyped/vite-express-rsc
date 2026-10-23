import type { RequestHandler } from "express";

/** Block the catch-all route when the test requests a denied response. */
const middleware: RequestHandler = (req, res, next) => {
  if (req.get("x-block-splat")) {
    res.status(403).send("Documentation denied");

    return;
  }

  next();
};

export default middleware;
