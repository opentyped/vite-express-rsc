import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import type { Middlewares, PageLoader } from "./types.js";

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

// UI preflight can redirect or deny before React Router encodes the response.
// Capture completion without committing the socket, then restore the native methods.
function capture(res: Response, done: (response: globalThis.Response) => void) {
  const original = {
    end: res.end,
    write: res.write,
    writeHead: res.writeHead,
    status: res.statusCode,
  };

  res.write = (() => {
    throw new Error("UI middleware and loaders cannot stream; use route.ts");
  }) as Response["write"];
  res.writeHead = (() => {
    throw new Error(
      "UI response headers are committed by the RSC adapter; use res.set() or route.ts",
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

    const body =
      chunk === undefined
        ? null
        : Buffer.isBuffer(chunk)
          ? new Uint8Array(chunk)
          : String(chunk);
    const status = res.statusCode;

    headers.delete("content-length");
    headers.delete("transfer-encoding");

    for (const key of [
      "content-length",
      "transfer-encoding",
      "etag",
      "location",
    ]) {
      res.removeHeader(key);
    }

    res.statusCode = original.status;
    done(
      new globalThis.Response([204, 205, 304].includes(status) ? null : body, {
        status,
        headers,
      }),
    );

    return res;
  }) as Response["end"];

  return () => {
    res.end = original.end;
    res.write = original.write;
    res.writeHead = original.writeHead;
  };
}

export async function middleware(
  req: Request,
  res: Response,
  stack: RequestHandler[],
  ui: boolean,
): Promise<globalThis.Response | boolean> {
  if (!stack.length) {
    return false;
  }

  const router = Router({ mergeParams: true });

  router.use(...stack);

  let restore = () => {};

  let cleanup = () => {};

  try {
    return await new Promise((resolve, reject) => {
      if (ui) {
        restore = capture(res, resolve);
      }

      const finish = () => resolve(true);
      const close = () => reject(new Error("Request closed during middleware"));

      if (!ui) {
        res.once("finish", finish);
      }

      res.once("close", close);
      cleanup = () => {
        res.off("finish", finish);
        res.off("close", close);
      };

      router(req, res, (error?: unknown) => {
        res.off("finish", finish);
        res.off("close", close);

        if (error) {
          reject(error);
        } else {
          resolve(false);
        }
      });
    });
  } finally {
    cleanup();
    restore();
  }
}

export async function load(
  req: Request,
  res: Response,
  loader: PageLoader,
): Promise<unknown> {
  let response: globalThis.Response | undefined;
  const restore = capture(res, (value) => {
    response = value;
  });

  try {
    const value = await loader(req, res);

    if (response) {
      if (
        response.headers.has("location") &&
        response.status >= 300 &&
        response.status < 400
      ) {
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

export async function endpoint(
  req: Request,
  res: Response,
  module: Record<string, unknown>,
  page = false,
): Promise<boolean> {
  const router = Router({ mergeParams: true });

  if (page) {
    router.get("/", (_req, _res, next) => next());
  }

  for (const method of [
    "HEAD",
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ] as const) {
    const handler = module[method];

    if (handler !== undefined) {
      if (typeof handler !== "function") {
        throw new Error(`${method} must be an Express handler`);
      }

      const native = handler as RequestHandler;

      router[method.toLowerCase() as "get"](
        "/",
        ...handlers(native.middlewares),
        native,
      );
    }
  }

  const url = req.url;
  const baseUrl = req.baseUrl;

  req.baseUrl += req.path;
  req.url = "/" + (url.includes("?") ? url.slice(url.indexOf("?")) : "");

  try {
    return !!(await middleware(req, res, [router], false));
  } finally {
    req.url = url;
    req.baseUrl = baseUrl;
  }
}

export function setParams(
  req: Request,
  params: Record<string, string | undefined>,
) {
  req.params = Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
