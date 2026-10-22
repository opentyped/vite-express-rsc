import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  renderToReadableStream,
} from "@vitejs/plugin-rsc/rsc";
import { unstable_matchRSCServerRequest as match } from "react-router";
import type { Request, Response, NextFunction } from "express";
import { createRequest, createHeaders } from "@remix-run/node-fetch-server";
import { randomUUID } from "node:crypto";
import { definitions } from "virtual:express-rsc/routes";
import clientVersion from "virtual:express-rsc/version";
import { createRoutes } from "./routes.js";
import { withRequestContext } from "./context.js";
import { rendering, type RenderState } from "./state.js";
import { matchDefinitions, modules, prepare } from "./prepare.js";
import { endpoint } from "./express.js";
import { sendResponse } from "./response.js";

const routes = createRoutes(definitions);

/**
 * Bridge Express state into the RSC graph without sharing context storage across
 * environments.
 */
export async function dispatch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableFinished) {
      controller.abort(new Error("Client disconnected"));
    }
  };

  res.once("close", disconnected);

  const context = {
    signal: controller.signal,
    nonce: res.locals.nonce,
    requestId: res.locals.requestId ?? randomUUID(),
    user: res.locals.user,
    headers: createHeaders(req),
    services: res.locals.services,
  };

  try {
    return await withRequestContext(context, () =>
      dispatchRequest(req, res, next),
    );
  } finally {
    res.off("close", disconnected);
  }
}

async function dispatchRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // These are the reserved request suffixes of the pinned React Router RSC runtime.
  const url = new URL(req.originalUrl, "http://localhost");
  const rsc = url.pathname.endsWith(".rsc");
  const manifest = url.pathname.endsWith(".manifest");
  const pathname = rsc ? url.pathname.slice(0, -4) || "/" : url.pathname;
  const branch = manifest ? [] : matchDefinitions(definitions, pathname);
  const last = branch.at(-1)?.definition;
  const loaded = await modules(branch);
  const raw =
    !rsc &&
    !manifest &&
    loaded.route &&
    ((req.method !== "GET" && req.method !== "HEAD") || !loaded.page);
  const state: RenderState = {
    results: new Map(),
    metadata: {},
    params: branch.at(-1)?.params ?? {},
    page: last,
  };

  await prepare(req, res, loaded, state, !raw);

  if (res.destroyed) {
    return;
  }

  if (raw) {
    if (state.terminal instanceof globalThis.Response) {
      throw state.terminal;
    }

    if (state.terminal === true) {
      return;
    }

    if (state.terminal) {
      throw state.terminal;
    }

    if (await endpoint(req, res, loaded.route!, !!loaded.page)) {
      return;
    }

    next();

    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (state.terminal instanceof globalThis.Response) {
      await sendResponse(res, state.terminal);

      return;
    }

    if (state.terminal !== undefined) {
      throw state.terminal;
    }

    res.set("Allow", "GET, HEAD").status(405).end();

    return;
  }

  if (!manifest && !loaded.page && state.terminal === undefined) {
    state.terminal = new globalThis.Response("Not found", { status: 404 });
    state.terminalId = last?.id;
  }

  let request = createRequest(req, res);

  if (state.terminal !== undefined) {
    // A caller-controlled partial-loader filter cannot suppress a guard/error loader.
    const target = new URL(request.url);

    target.searchParams.delete("_routes");
    request = new globalThis.Request(target, request);
  }

  const response = await rendering.run(state, async () => {
    const serverResponse = await match({
      request,
      routes,
      clientVersion,
      createTemporaryReferenceSet,
      decodeAction,
      decodeFormState,
      decodeReply,
      loadServerAction: async () => {
        throw new Error("Server functions are disabled; use route.ts");
      },
      generateResponse(result, options) {
        const headers = new Headers(result.headers);

        headers.set("Content-Type", "text/x-component");

        // Express response fields are staged until React Router's protocol has decided the response.
        const status =
          result.statusCode === 200 ? res.statusCode : result.statusCode;

        return new globalThis.Response(
          renderToReadableStream(result.payload, options),
          { status, headers },
        );
      },
    });
    const ssr = await import.meta.viteRsc.loadModule<typeof import("./ssr.js")>(
      "ssr",
      "render",
    );

    const nonce: unknown = res.locals.nonce;

    if (nonce !== undefined && typeof nonce !== "string") {
      throw new TypeError("res.locals.nonce must be a string when supplied");
    }

    return ssr.generateHTML(request, serverResponse, nonce);
  });

  await sendResponse(res, response);
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
