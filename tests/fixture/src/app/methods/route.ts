import type { RequestHandler } from "express";

/** Echo native Express request values to verify HTTP method handling. */
const handler: RequestHandler = (req, res) => {
  res.set("X-Native-Method", req.method).json({
    method: req.method,
    params: req.params,
    query: req.query,
    body: req.body ?? null,
  });
};

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
