import type { RequestHandler } from "express";

const middleware: RequestHandler = (req, res, next) => {
  if (req.get("x-block-splat")) {
    res.status(403).send("Documentation denied");

    return;
  }

  next();
};

export default middleware;
