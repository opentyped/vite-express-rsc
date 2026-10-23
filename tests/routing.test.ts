import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type RequestHandler } from "express";
import { scan, endpoints } from "../packages/vite-express-rsc/dist/routes.js";
import {
  createRouter,
  type Renderer,
} from "../packages/vite-express-rsc/dist/runtime/router.js";

const contextModule = resolve(
  import.meta.dirname,
  "../packages/vite-express-rsc/dist/runtime/context.js",
);
const page = "export default function Page() { return null; }\n";
const layout = "export default function Layout() { return null; }\n";
/** Record a step in the request's middleware order. */
const step = (name: string) =>
  `(req, res, next) => { res.locals.order.push(${JSON.stringify(name)}); next(); }`;

// One route tree exercising every routing convention.
const files: Record<string, string> = {
  "middleware.ts": `export default (req, res, next) => {
    res.locals.order.push("root");
    if (req.get("x-deny-root")) return res.status(401).json({ denied: "root" });
    next();
  };`,
  "layout.tsx": layout,
  "page.tsx": page,
  "components/Button.tsx": "export default function Button() { return null; }",

  "users/new/page.tsx": `export const middlewares = []; ${page}`,
  "users/[id]/route.ts": `
    export const middlewares = [${step("module")}];
    export const GET = (req, res) => res.json({ params: req.params, order: res.locals.order });
    GET.middlewares = [${step("get")}];
    export const POST = (req, res) => res.status(201).json(req.body);
    export const PUT = (req, res) => res.json({ method: "PUT", id: req.params.id });
    export const PATCH = (req, res) => res.json({ method: "PATCH", id: req.params.id });
    export const DELETE = (req, res) => res.sendStatus(204);`,
  "users/[id]/posts/[postId]/route.ts": `export const GET = (req, res) => res.json({ params: req.params });`,

  "docs/intro/page.tsx": page,
  "docs/[...slug]/page.tsx": page,
  "files/[...path]/route.ts": `export const GET = (req, res) => res.json({ params: req.params });`,

  "(marketing)/layout.tsx": `export const middlewares = []; ${layout}`,
  "(marketing)/about/page.tsx": page,
  "(marketing)/pricing/route.ts": `export const GET = (req, res) => res.json({ order: res.locals.order });`,
  "contact/route.ts": `export const GET = (req, res) => res.json({ order: res.locals.order });`,

  "admin/middleware.ts": `export default (req, res, next) => {
    if (!req.get("x-admin")) return res.status(403).json({ error: "forbidden" });
    res.locals.order.push("admin");
    next();
  };`,
  "admin/page.tsx": page,
  "admin/reports/route.ts": `
    export let calls = 0;
    export const GET = (req, res) => { calls++; res.json({ order: res.locals.order }); };`,
  "admin/redirect/middleware.ts": `export default (req, res) => res.redirect("/login");`,
  "admin/redirect/page.tsx": page,

  "shared/page.tsx": page,
  "shared/route.ts": `export const POST = (req, res) => res.status(201).json({ posted: req.body });`,

  "head/route.ts": `
    export const GET = (req, res) => res.set("x-from", "get").send("body");
    export const HEAD = (req, res) => res.set("x-from", "head").end();`,

  "errors/route.ts": `
    export const GET = () => { throw new Error("sync failure"); };
    export const POST = async () => { throw new Error("async failure"); };
    export const PUT = (req, res, next) => next(new Error("next failure"));`,
  "failing/middleware.ts": `export default (req, res, next) => next(new Error("guard failed"));`,
  "failing/page.tsx": page,

  "skip/middleware.ts": `export default (req, res, next) => next("route");`,
  "skip/route.ts": `export const GET = (req, res) => res.json({ reached: true });`,

  "context/route.ts": `
    import { getRequestContext } from ${JSON.stringify(contextModule)};
    export const GET = async (req, res) => {
      const before = getRequestContext().locals.id;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
      res.json({ before, after: getRequestContext().locals.id, url: getRequestContext().url.href });
    };`,
};

/** Page and layout middleware live in the RSC graph; these stand in for it. */
const uiMiddlewares: Record<string, RequestHandler[]> = {
  "layout:(marketing)": [
    (_req, res, next) => {
      res.locals.order.push("marketing");
      next();
    },
  ],
  "page:users/new": [
    (_req, res, next) => {
      res.locals.order.push("page");
      next();
    },
  ],
};

/** Describe a guard outcome in a JSON-friendly way. */
function describe(terminal: unknown) {
  if (terminal instanceof Response) {
    return {
      status: terminal.status,
      location: terminal.headers.get("location"),
    };
  }

  return terminal instanceof Error ? { error: terminal.message } : terminal;
}

/** A renderer that reports what it was asked to render instead of rendering React. */
const renderer: Renderer = {
  async middlewares(ids) {
    return Object.fromEntries(ids.map((id) => [id, uiMiddlewares[id] ?? []]));
  },
  async render(req, res, { endpoint, preflight }) {
    res.set("x-rendered", "yes").json({
      page: endpoint?.page ?? null,
      layouts: endpoint?.layouts ?? [],
      params: req.params,
      query: req.query,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      order: res.locals.order,
      terminal: describe(preflight.terminal) ?? null,
      terminalId: preflight.terminalId ?? null,
    });
  },
};

let directory: string;
let server: Server;
let base: string;

before(async () => {
  // Node strips types only outside node_modules, so fixtures live in the OS temp folder.
  directory = mkdtempSync(join(tmpdir(), "express-rsc-routing-"));

  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), source);
  }

  const list = endpoints(scan(directory));
  const modules: Record<string, () => Promise<Record<string, unknown>>> = {};

  for (const endpoint of list) {
    for (const file of [
      endpoint.route,
      ...endpoint.guards.map((guard) => guard.middleware),
    ]) {
      if (file) {
        modules[file] = () => import(file);
      }
    }
  }

  const router = createRouter({
    endpoints: list,
    modules,
    renderer: async () => renderer,
  });
  const app = express();

  app.use((req, res, next) => {
    res.locals.order = ["global"];
    res.locals.id = req.get("x-id");
    next();
  });
  app.use(express.json());
  app.use(router);
  app.use("/mounted", router);
  // The application owns 404s and errors.
  app.use((_req, res) => {
    res.status(404).json({ fallthrough: true });
  });
  app.use(((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  }) as express.ErrorRequestHandler);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Send a request and parse a JSON body when there is one. */
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, { redirect: "manual", ...init });
  const text = await response.text();
  let body: unknown = text;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Plain-text body.
  }

  return {
    status: response.status,
    headers: response.headers,
    body: body as Record<string, unknown>,
  };
}

test("registrations are deterministic and ordered most specific first", () => {
  const paths = endpoints(scan(directory)).map((endpoint) => endpoint.path);

  assert.deepEqual(
    paths,
    endpoints(scan(directory)).map((endpoint) => endpoint.path),
  );
  assert.deepEqual(paths, [
    "/",
    "/about",
    "/admin",
    "/admin/redirect",
    "/admin/reports",
    "/contact",
    "/context",
    "/docs/intro",
    "/docs/*slug",
    "/errors",
    "/failing",
    "/files/*path",
    "/head",
    "/pricing",
    "/shared",
    "/skip",
    "/users/new",
    "/users/:id",
    "/users/:id/posts/:postId",
  ]);
  assert.ok(!paths.some((path) => path.includes("components")));
});

test("static segments win over dynamic ones, dynamic over catch-alls", async () => {
  assert.equal((await call("/users/new")).body.page, "page:users/new");
  assert.deepEqual((await call("/users/42")).body.params, { id: "42" });
  assert.equal((await call("/docs/intro")).body.page, "page:docs/intro");

  const splat = await call("/docs/a/b/c");

  assert.equal(splat.body.page, "page:docs/[...slug]");
  assert.deepEqual(splat.body.params, { slug: ["a", "b", "c"] });
});

test("params reach native handlers, including nested and catch-all params", async () => {
  assert.deepEqual((await call("/users/7/posts/99")).body.params, {
    id: "7",
    postId: "99",
  });
  assert.deepEqual((await call("/files/a/b.txt")).body.params, {
    path: ["a", "b.txt"],
  });
  assert.deepEqual((await call("/users/caf%C3%A9")).body.params, {
    id: "café",
  });
  // A catch-all needs at least one segment.
  assert.equal((await call("/files")).body.fallthrough, true);
});

test("pathless groups add no URL segment but keep their layout middleware", async () => {
  const about = await call("/about");

  assert.equal(about.body.page, "page:(marketing)/about");
  assert.deepEqual(about.body.layouts, ["layout:", "layout:(marketing)"]);
  assert.deepEqual(about.body.order, ["global", "root", "marketing"]);
  // The group's layout guards its raw endpoints too, and nothing outside the group.
  assert.deepEqual((await call("/pricing")).body.order, [
    "global",
    "root",
    "marketing",
  ]);
  assert.deepEqual((await call("/contact")).body.order, ["global", "root"]);
  assert.equal((await call("/(marketing)/about")).status, 404);
});

test("middleware runs global, ancestors outer-to-inner, page or module, then method", async () => {
  assert.deepEqual((await call("/users/1")).body.order, [
    "global",
    "root",
    "module",
    "get",
  ]);
  assert.deepEqual((await call("/users/new")).body.order, [
    "global",
    "root",
    "page",
  ]);
  assert.deepEqual(
    (await call("/admin/reports", { headers: { "x-admin": "1" } })).body.order,
    ["global", "root", "admin"],
  );
});

test("guards stop raw endpoints before the handler runs", async () => {
  const module = await import(join(directory, "admin/reports/route.ts"));
  const calls = module.calls;
  const denied = await call("/admin/reports");

  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: "forbidden" });
  assert.equal(module.calls, calls);

  const root = await call("/users/1", { headers: { "x-deny-root": "1" } });

  assert.equal(root.status, 401);
  assert.deepEqual(root.body, { denied: "root" });
});

test("guard responses and errors on pages go to the renderer, not the socket", async () => {
  const denied = await call("/admin");

  assert.equal(denied.headers.get("x-rendered"), "yes");
  assert.deepEqual(denied.body.terminal, { status: 403, location: null });
  assert.equal(denied.body.terminalId, "layout:admin");

  const redirect = await call("/admin/redirect", {
    headers: { "x-admin": "1" },
  });

  assert.deepEqual(redirect.body.terminal, { status: 302, location: "/login" });
  assert.equal(redirect.body.terminalId, "layout:admin/redirect");

  const failed = await call("/failing");

  assert.deepEqual(failed.body.terminal, { error: "guard failed" });
  assert.equal(failed.body.terminalId, "layout:failing");

  const allowed = await call("/admin", { headers: { "x-admin": "1" } });

  assert.equal(allowed.body.terminal, null);
  assert.equal(allowed.body.terminalId, null);
});

test("HTTP methods map to native handlers with Express defaults", async () => {
  const posted = await call("/users/5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name":"Ada"}',
  });

  assert.equal(posted.status, 201);
  assert.deepEqual(posted.body, { name: "Ada" });
  assert.deepEqual((await call("/users/5", { method: "PUT" })).body, {
    method: "PUT",
    id: "5",
  });
  assert.deepEqual((await call("/users/5", { method: "PATCH" })).body, {
    method: "PATCH",
    id: "5",
  });
  assert.equal((await call("/users/5", { method: "DELETE" })).status, 204);

  // HEAD falls back to GET without a body; an explicit HEAD wins.
  const implicit = await call("/users/5", { method: "HEAD" });

  assert.equal(implicit.status, 200);
  assert.equal(implicit.body, null);
  assert.equal(
    (await call("/head", { method: "HEAD" })).headers.get("x-from"),
    "head",
  );
  assert.equal((await call("/head")).headers.get("x-from"), "get");

  // OPTIONS lists the route's methods; an unexported method is not found.
  const options = await call("/users/5", { method: "OPTIONS" });

  assert.equal(options.status, 200);
  assert.deepEqual(options.headers.get("allow")!.split(", ").sort(), [
    "DELETE",
    "GET",
    "HEAD",
    "PATCH",
    "POST",
    "PUT",
  ]);
  assert.equal(
    (await call("/contact", { method: "POST" })).body.fallthrough,
    true,
  );
});

test("a page and a raw route can share one URL; other methods get 405", async () => {
  assert.equal((await call("/shared")).body.page, "page:shared");

  const posted = await call("/shared", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[1]",
  });

  assert.equal(posted.status, 201);
  assert.deepEqual(posted.body, { posted: [1] });

  const deleted = await call("/shared", { method: "DELETE" });

  assert.equal(deleted.status, 405);
  assert.equal(deleted.headers.get("allow"), "GET, HEAD, POST, OPTIONS");
  assert.equal(
    (await call("/shared", { method: "OPTIONS" })).headers.get("allow"),
    "GET, HEAD, POST, OPTIONS",
  );
  // Guards still run before a 405, so it reveals nothing to denied clients.
  assert.equal((await call("/admin", { method: "POST" })).status, 403);
});

test("React Router data URLs map to their pages and never to raw endpoints", async () => {
  const navigation = await call("/users/new.rsc?tab=1");

  assert.equal(navigation.body.page, "page:users/new");
  assert.equal(navigation.body.originalUrl, "/users/new.rsc?tab=1");
  assert.deepEqual(navigation.body.query, { tab: "1" });
  assert.equal((await call("/_.rsc")).body.page, "page:");
  assert.equal((await call("/docs/intro.rsc")).body.page, "page:docs/intro");

  // A raw route or an unknown URL still answers navigations with a rendered 404.
  for (const path of ["/users/5.rsc", "/nowhere.rsc"]) {
    const response = await call(path);

    assert.equal(response.body.page, null, path);
    assert.deepEqual(
      response.body.terminal,
      { status: 404, location: null },
      path,
    );
  }
});

test("unknown documents, trailing slashes, and case follow Express", async () => {
  assert.deepEqual((await call("/nowhere")).body, { fallthrough: true });
  assert.equal((await call("/users/new/")).body.page, "page:users/new");
  assert.equal((await call("/USERS/new")).body.page, "page:users/new");
  // A layout without a page is not a URL.
  assert.deepEqual((await call("/users")).body, { fallthrough: true });
});

test("errors and next('route') reach the application's handlers", async () => {
  for (const method of ["GET", "POST", "PUT"]) {
    const response = await call("/errors", { method });

    assert.equal(response.status, 500, method);
  }

  assert.deepEqual((await call("/errors")).body, { error: "sync failure" });
  assert.deepEqual((await call("/errors", { method: "POST" })).body, {
    error: "async failure",
  });
  assert.deepEqual((await call("/errors", { method: "PUT" })).body, {
    error: "next failure",
  });
  assert.deepEqual((await call("/skip")).body, { fallthrough: true });
});

test("the router works under a mount path", async () => {
  const mounted = await call("/mounted/users/new");

  assert.equal(mounted.body.page, "page:users/new");
  assert.equal(mounted.body.baseUrl, "/mounted");
  assert.deepEqual((await call("/mounted/users/3/posts/4")).body.params, {
    id: "3",
    postId: "4",
  });
});

test("request context stays isolated across concurrent requests", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      call("/context", { headers: { "x-id": `request-${i}` } }),
    ),
  );

  results.forEach((result, i) => {
    assert.equal(result.body.before, `request-${i}`);
    assert.equal(result.body.after, `request-${i}`);
  });
  assert.equal(results[0].body.url, `${base}/context`);
});
