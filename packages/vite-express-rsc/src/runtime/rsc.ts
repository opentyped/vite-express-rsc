import {
  createTemporaryReferenceSet,
  renderToReadableStream,
} from "@vitejs/plugin-rsc/rsc";
import { unstable_matchRSCServerRequest as match } from "react-router";
import type { Request, Response, RequestHandler } from "express";
import { tree } from "virtual:express/rsc/routes";
import clientVersion from "virtual:express/rsc/version";
import { withRequestContext, type RequestContext } from "./context.js";
import { createRoutes, flatten } from "./routes.js";
import { rendering, type RenderState } from "./state.js";
import { handlers, load } from "./express.js";
import { resolveMetadata } from "./metadata.js";
import { sendResponse } from "./response.js";
import type { Preflight } from "./router.js";
import type { Endpoint } from "../routes.js";
import type { PageProps, RouteModule } from "./types.js";

const routes = createRoutes(tree);
const modules = flatten(tree);

/** Load the page or layout module registered under a route id. */
async function moduleOf(id: string): Promise<RouteModule> {
  const loader = modules.get(id);

  if (!loader) {
    throw new Error(`Unknown route module: ${id}`);
  }

  return loader();
}

/**
 * Return the `middlewares` exported by pages and layouts. They run in Express's
 * chain, but their code belongs to this graph, so each call enters this graph's
 * request context.
 */
export async function middlewares(
  ids: string[],
  context: RequestContext,
): Promise<Record<string, RequestHandler[]>> {
  const result: Record<string, RequestHandler[]> = {};

  for (const id of ids) {
    result[id] = handlers((await moduleOf(id)).middlewares).map(
      (handler): RequestHandler =>
        (req, res, next) =>
          withRequestContext(context, () => handler(req, res, next)),
    );
  }

  return result;
}

/** Plain string params for loaders and metadata; catch-alls become `a/b`. */
function paramsOf(req: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.params as Record<string, string | string[]>).map(
      ([key, value]) => [key, Array.isArray(value) ? value.join("/") : value],
    ),
  );
}

/** Run layout and page loaders outer-to-inner, then resolve metadata. */
async function prepare(
  req: Request,
  res: Response,
  endpoint: Endpoint,
  state: RenderState,
) {
  const params = paramsOf(req);
  const chain: { id: string; module: RouteModule; props: PageProps }[] = [];

  for (const id of [...endpoint.layouts, endpoint.page!]) {
    state.terminalId = id;

    const module = await moduleOf(id);
    const loaderData = module.loader
      ? await load(req, res, module.loader)
      : undefined;

    state.results.set(id, loaderData);
    chain.push({ id, module, props: { loaderData, params } });
  }

  state.metadata = await resolveMetadata(chain);
  state.terminalId = undefined;
}

export interface RenderOptions {
  /** The matched page; absent for route discovery and unknown navigations. */
  endpoint?: Endpoint;
  context: RequestContext;
  preflight: Preflight;
}

/** Render a page document or navigation payload through React Router. */
export async function render(
  req: Request,
  res: Response,
  { endpoint, context, preflight }: RenderOptions,
) {
  const state: RenderState = {
    results: new Map(),
    metadata: {},
    terminal: preflight.terminal,
    terminalId: preflight.terminalId,
  };

  await withRequestContext(context, async () => {
    if (endpoint && state.terminal === undefined) {
      try {
        await prepare(req, res, endpoint, state);
      } catch (error) {
        state.terminal = error ?? new Error("Loader threw an empty value");
      }
    }

    let request = new globalThis.Request(context.url, {
      method: req.method,
      headers: context.headers,
      signal: context.signal,
    });

    if (state.terminal !== undefined) {
      // A client-chosen `_routes` filter must not skip the route that failed.
      const url = new URL(request.url);

      url.searchParams.delete("_routes");
      request = new globalThis.Request(url, request);
    }

    const response = await rendering.run(state, async () => {
      const payload = await match({
        request,
        routes,
        clientVersion,
        basename: req.baseUrl || undefined,
        createTemporaryReferenceSet,
        loadServerAction: async () => {
          throw new Error("Server functions are disabled; use route.ts");
        },
        /** Encode React Router's result, keeping a status chosen by Express handlers. */
        generateResponse(result, options) {
          const headers = new Headers(result.headers);

          headers.set("Content-Type", "text/x-component");

          return new globalThis.Response(
            renderToReadableStream(result.payload, options),
            {
              status:
                result.statusCode === 200 ? res.statusCode : result.statusCode,
              headers,
            },
          );
        },
      });
      const ssr = await import.meta.viteRsc.loadModule<
        typeof import("./ssr.js")
      >("ssr", "render");

      return ssr.generateHTML(request, payload, context.nonce);
    });

    await sendResponse(res, response);
  });
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
