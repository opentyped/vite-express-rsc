import type { OpenAPIOperation, Middlewares } from "./runtime/types.js";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import type {} from "express";

declare module "express" {
  // These defaults must match Express for declaration merging.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
  interface RequestHandler<
    P = ParamsDictionary,
    ResBody = any,
    ReqBody = any,
    ReqQuery = Query,
    Locals extends Record<string, any> = Record<string, any>,
  > {
    openapi?: OpenAPIOperation;
    middlewares?: Middlewares;
  }
}
