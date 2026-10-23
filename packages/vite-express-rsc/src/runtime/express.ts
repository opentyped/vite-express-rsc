import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Middlewares } from "./types.js";

/** Turn one middleware or an array into a checked list of Express handlers. */
export function handlers(value: Middlewares | undefined): RequestHandler[] {
  const result =
    value === undefined ? [] : Array.isArray(value) ? [...value] : [value];

  if (result.some((handler) => typeof handler !== "function")) {
    throw new Error(
      "middlewares must be an Express handler or an array of handlers",
    );
  }

  return result as RequestHandler[];
}

/**
 * Run handlers one after another with Express semantics: `next()` continues,
 * `next(error)`, `next("route")` and `next("router")` leave the sequence, and a
 * rejected promise becomes `next(error)`.
 */
export function run(
  list: readonly RequestHandler[],
  req: Request,
  res: Response,
  done: NextFunction,
): void {
  let index = 0;

  /** Call the next handler, or leave the sequence. */
  const next: NextFunction = (signal?: unknown) => {
    if (signal !== undefined || index === list.length) {
      done(signal);

      return;
    }

    const handler = list[index++];

    try {
      const result: unknown = handler(req, res, next);

      if (result instanceof Promise) {
        result.catch((error: unknown) => next(error ?? new Error("Rejected")));
      }
    } catch (error) {
      next(error);
    }
  };

  next();
}

/**
 * Intercept `res.end()` so a UI guard or loader that responds (redirect, 403,
 * …) becomes a React Router response instead of committing the socket. Calls
 * go through the original methods afterwards, so wrappers installed by earlier
 * middleware (sessions, compression) still see the final response.
 */
export function capture(
  res: Response,
  done: (response: globalThis.Response) => void,
): () => void {
  const original = { end: res.end, write: res.write, writeHead: res.writeHead };
  const status = res.statusCode;

  res.write = (() => {
    throw new Error(
      "Page middleware and loaders cannot stream; use route.ts for streaming responses",
    );
  }) as Response["write"];
  res.writeHead = (() => {
    throw new Error(
      "Page responses are committed by the renderer; use res.set() or route.ts",
    );
  }) as Response["writeHead"];
  res.end = ((chunk?: unknown) => {
    const headers = new Headers();

    for (const [key, value] of Object.entries(res.getHeaders())) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) {
          headers.append(key, String(item));
        }
      }
    }

    // The renderer recomputes framing, and the redirect target travels in the payload.
    for (const key of [
      "content-length",
      "transfer-encoding",
      "etag",
      "location",
    ]) {
      res.removeHeader(key);
    }

    headers.delete("content-length");
    headers.delete("transfer-encoding");

    const code = res.statusCode;
    const body =
      chunk === undefined || [204, 205, 304].includes(code)
        ? null
        : Buffer.isBuffer(chunk)
          ? new Uint8Array(chunk)
          : String(chunk);

    res.statusCode = status;
    done(new globalThis.Response(body, { status: code, headers }));

    return res;
  }) as Response["end"];

  return () => Object.assign(res, original);
}

/** Run a page loader; a response it sends must be a redirect. */
export async function load(
  req: Request,
  res: Response,
  loader: (req: Request, res: Response) => unknown,
): Promise<unknown> {
  let response: globalThis.Response | undefined;
  const restore = capture(res, (value) => (response = value));

  try {
    const value = await loader(req, res);

    if (response) {
      if (response.status >= 300 && response.status < 400) {
        throw response;
      }

      throw new Error(
        "Page loaders return data; use route.ts for res.send(), res.json(), or res.end()",
      );
    }

    return value;
  } finally {
    restore();
  }
}
