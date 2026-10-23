import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { createHeaders } from "@remix-run/node-fetch-server";
import {
  getRequestContext,
  withRequestContext,
  type RequestContext,
} from "./context.js";
import { capture, handlers, run } from "./express.js";
import type { Endpoint, Guard } from "../routes.js";

type Module = Record<string, unknown>;

export interface RouterManifest {
  endpoints: Endpoint[];
  modules: Record<string, () => Promise<Module>>;
  /** Page renderer; defaults to the RSC environment's entry. */
  renderer?: () => Promise<Renderer>;
}

/** What the page renderer needs to know about the guards that already ran. */
export interface Preflight {
  /** A response or error produced by a guard, rendered by the nearest boundary. */
  terminal?: unknown;
  /** Route id whose guard produced `terminal`. */
  terminalId?: string;
}

/** What the router needs from the server-component environment. */
export type Renderer = Pick<
  typeof import("./rsc.js"),
  "middlewares" | "render"
>;

/** Load the server-component environment that renders pages. */
const loadRenderer = () =>
  import.meta.viteRsc.loadModule<Renderer>("rsc", "index");

/** React Router navigation URLs, keyed by request, before they are rewritten. */
const navigations = new WeakSet<Request>();

/** Map React Router's `.rsc` data URLs onto the page URL Express matches. */
function rewrite(req: Request) {
  const [pathname, search = ""] = req.url.split(/\?(.*)/s, 2);

  if (!pathname.endsWith(".rsc")) {
    return;
  }

  navigations.add(req);
  // `/_.rsc` is React Router's name for index and trailing-slash navigations.
  req.url =
    (pathname.endsWith("/_.rsc")
      ? pathname.slice(0, -5)
      : pathname.slice(0, -4) || "/") + (search && "?" + search);
}

/** Absolute URL for this request, honoring the application's proxy settings. */
function urlOf(req: Request): URL {
  return new URL(req.originalUrl, `${req.protocol}://${req.host}`);
}

/** Create the per-request context and abort it when the client disconnects. */
function contextOf(req: Request, res: Response): RequestContext {
  const controller = new AbortController();

  res.once("close", () => {
    if (!res.writableFinished) {
      controller.abort(new Error("Client disconnected"));
    }
  });

  const nonce: unknown = res.locals.nonce;

  if (nonce !== undefined && typeof nonce !== "string") {
    throw new TypeError("res.locals.nonce must be a string when supplied");
  }

  return {
    signal: controller.signal,
    url: urlOf(req),
    headers: createHeaders(req),
    locals: res.locals,
    nonce,
  };
}

/** Build the Express router for one route directory. */
export function createRouter({
  endpoints,
  modules,
  renderer: rsc = loadRenderer,
}: RouterManifest) {
  const router = Router();

  /** Import a native module from the Node graph. */
  const native = (file: string) => modules[file]();

  /**
   * Resolve the guard chain for an endpoint. Directory middleware is native;
   * layout `middlewares` live in layout.tsx and come from the RSC graph.
   * `track` records which route a guard belongs to, for error boundaries.
   */
  const guardsOf = async (
    guards: Guard[],
    context: RequestContext,
    track?: Preflight,
  ): Promise<RequestHandler[]> => {
    const ids = guards.flatMap((guard) => (guard.layout ? [guard.layout] : []));
    const ui = ids.length ? await (await rsc()).middlewares(ids, context) : {};
    const list: RequestHandler[] = [];

    for (const guard of guards) {
      if (track) {
        list.push((_req, _res, next) => {
          track.terminalId = guard.id;
          next();
        });
      }

      if (guard.middleware) {
        const handler = (await native(guard.middleware)).default;

        if (typeof handler !== "function") {
          throw new Error(
            `middleware.ts must default-export an Express handler: ${guard.middleware}`,
          );
        }

        list.push(handler as RequestHandler);
      }

      if (guard.layout) {
        list.push(...ui[guard.layout]);
      }
    }

    return list;
  };

  /** Run inherited guards with native Express semantics. */
  const guarded =
    (endpoint: Endpoint): RequestHandler =>
    async (req, res, next) => {
      run(await guardsOf(endpoint.guards, getRequestContext()), req, res, next);
    };

  /** Run a raw route method with module and method middleware. */
  const method =
    (endpoint: Endpoint, name: string): RequestHandler =>
    async (req, res, next) => {
      const module = await native(endpoint.route!);
      const handler = module[name] as RequestHandler & Module;

      if (typeof handler !== "function") {
        throw new Error(
          `${name} must be an Express handler: ${endpoint.route}`,
        );
      }

      run(
        [
          ...handlers(module.middlewares as RequestHandler[] | undefined),
          ...handlers(handler.middlewares as RequestHandler[] | undefined),
          handler,
        ],
        req,
        res,
        next,
      );
    };

  /**
   * Render a page. Guards run first while the response is captured, so a
   * redirect or denial becomes part of React Router's protocol (a 302 for a
   * document, a redirect payload for a navigation) instead of raw bytes.
   */
  const page =
    (endpoint: Endpoint): RequestHandler =>
    async (req, res, next) => {
      const context = getRequestContext();
      const preflight: Preflight = {};
      const renderer = await rsc();
      const list = await guardsOf(endpoint.guards, context, preflight);

      if (endpoint.pageMiddlewares) {
        const own = await renderer.middlewares([endpoint.page!], context);

        list.push(
          (_req, _res, next) => {
            preflight.terminalId = endpoint.page;
            next();
          },
          ...own[endpoint.page!],
        );
      }

      let restore = () => {};

      const signal = await new Promise<unknown>((resolve) => {
        restore = capture(res, (response) => resolve({ response }));
        res.once("close", () => resolve({ closed: true }));
        run(list, req, res, (value) => resolve({ next: value }));
      }).finally(() => restore());

      if (res.destroyed) {
        return;
      }

      const outcome = signal as {
        response?: globalThis.Response;
        next?: unknown;
      };

      if (outcome.next === "route" || outcome.next === "router") {
        next(outcome.next);

        return;
      }

      if (outcome.response) {
        preflight.terminal = outcome.response;
      } else if (outcome.next !== undefined) {
        preflight.terminal = outcome.next;
      } else {
        preflight.terminalId = undefined;
      }

      await renderer.render(req, res, { endpoint, context, preflight });
    };

  /** Answer an unsupported method on a page URL after its guards allow it. */
  const unsupported =
    (endpoint: Endpoint): RequestHandler =>
    (req, res) => {
      const allow = [
        ...new Set(["GET", "HEAD", ...endpoint.methods, "OPTIONS"]),
      ].join(", ");

      res.set("Allow", allow);

      if (req.method === "OPTIONS") {
        res.send(allow);
      } else {
        res.sendStatus(405);
      }
    };

  /** Raw endpoints never answer React Router data URLs. */
  const documentsOnly: RequestHandler = (req, _res, next) =>
    next(navigations.has(req) ? "route" : undefined);

  // Enter the request context and decode navigation URLs before matching.
  router.use((req, res, next) => {
    rewrite(req);
    withRequestContext(contextOf(req, res), next);
  });

  // React Router's route discovery runs no guards and returns no loader data.
  router.get("/.manifest", async (req, res) => {
    await (
      await rsc()
    ).render(req, res, { context: getRequestContext(), preflight: {} });
  });

  for (const endpoint of endpoints) {
    const route = router.route(endpoint.path);

    // Explicit raw methods first, so an exported HEAD wins over the page's GET.
    for (const name of endpoint.methods) {
      route[name.toLowerCase() as "get"](
        documentsOnly,
        guarded(endpoint),
        method(endpoint, name),
      );
    }

    if (endpoint.page) {
      route.get(page(endpoint));
      route.all(guarded(endpoint), unsupported(endpoint));
    }
  }

  // An unknown navigation still needs a React Router payload, so render its 404.
  router.use(async (req, res, next) => {
    if (!navigations.has(req)) {
      next();

      return;
    }

    const notFound = new globalThis.Response("Not found", { status: 404 });

    await (
      await rsc()
    ).render(req, res, {
      context: getRequestContext(),
      preflight: { terminal: notFound },
    });
  });

  return router;
}
