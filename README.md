# Vite + Express RSC

One package, `@opentyped/vite-express-rsc`, integrates Express 5, Vite, React 19 Server Components, and React Router **RSC Data Mode**. Express owns HTTP; Vite builds the whole application. There is one filesystem routing tree: filenames determine behavior, and an `api` folder is just a URL segment.

`packages/vite-express-rsc` contains the plugin/runtime/types. `examples/basic` demonstrates pages, raw endpoints, inherited authorization, loaders, metadata, streaming, and error boundaries. This is a working proof of concept, not a published framework.

```sh
npm install
npm run dev
```

Production, from either the repository root or `examples/basic` after the workspace install:

```sh
npm run build
node dist/index.js
```

Requires Node 22.22+; tested on Node 24. Set `PORT` to change the application's port.

## Configure one route directory

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { fullstack } from "@opentyped/vite-express-rsc";

export default defineConfig({
  plugins: [fullstack({ entry: "./src/index.ts", directory: "./src/app" })],
});
```

The configured directory can have any name. This example uses `app`:

```text
src/app/
  layout.tsx
  middleware.ts
  page.tsx
  dashboard/
    layout.tsx
    loading.tsx
    error.tsx
    page.tsx
    users/[id]/
      page.tsx
      export/route.ts
  api/users/[id]/route.ts
```

Mount the package router directly in your Express server:

```ts
// src/index.ts
import express from "express";
import { appRouter } from "@opentyped/vite-express-rsc/app";

const server = express();
server.use(sessionMiddleware);
server.use(authMiddleware);
server.use(express.json());
server.use("/", appRouter);
export const listener = server.listen(Number(process.env.PORT ?? 3000));
```

The application scripts are `"dev": "express-rsc"`, `"build": "vite build"`, and `"start": "node dist/index.js"`. Exporting `listener` lets the dev launcher close and restart Express. The launcher uses Vite middleware mode and sends HMR upgrades through that listener; it opens no second HTTP listener.

Use TypeScript's `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, and include `@opentyped/vite-express-rsc/types` and `@vitejs/plugin-rsc/types`. See the example tsconfig. Public route types are exported from the package root.

## File conventions

| File                            | Behavior                                                                             | Scope                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `page.tsx`                      | Default React component; optional `middlewares`, `loader`, `metadata`                | GET/HEAD at its directory URL                                |
| `routes.tsx` (`route.ts` alias) | Native Express HTTP method exports; optional `middlewares`                           | Its directory URL                                            |
| `layout.tsx`                    | Default component renders `<Outlet />`; optional `middlewares`, `loader`, `metadata` | Descendant pages; middleware also applies to raw descendants |
| `middleware.ts`                 | Default Express request handler                                                      | Directory and all matched descendants                        |
| `loading.tsx`                   | Default Suspense fallback component                                                  | Segment's UI rendering subtree                               |
| `error.tsx`                     | Default React Router error-boundary component                                        | Segment's UI subtree, including descendant loader failures   |

`[id]` creates `:id`; `(group)` adds no URL segment. A leaf `[...slug]` uses React Router's `params['*']` string. Catch-alls cannot have their own layout or route descendants. Repeated dynamic parameter names within a branch are rejected to prevent one URL segment silently overwriting another. Non-convention files are ordinary imports.

Pages and raw routes can share a directory: a page owns GET/HEAD, while its `route.ts` can export POST, PUT, etc. A raw GET or HEAD alongside a page is a build-time conflict. Duplicate normalized patterns and conflicting branches are rejected instead of shadowing each other. Method splitting across different pathless-group/dynamic branches at the same URL is rejected; co-locate those endpoints.

### Express middleware

A named `middlewares` export accepts one native Express handler or an array. Each handler executes per request; factories are called explicitly when declaring the array. There is no setup-time `mount()` export.

```tsx
// app/dashboard/layout.tsx
import { Outlet } from "react-router";
import type { Middlewares } from "@opentyped/vite-express-rsc";

export const middlewares = [
  requireSession,
  rateLimit({ limit: 100 }),
] satisfies Middlewares;

export default function Layout() {
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
```

That middleware protects descendant `page.tsx` **and** `route.ts` requests. The layout component, loader, and metadata participate only in page requests. Raw JSON/download responses are never wrapped in JSX.

For a directory-wide handler without a layout:

```ts
// app/dashboard/middleware.ts
import type { RequestHandler } from "express";

const middleware: RequestHandler = (req, res, next) => {
  res.locals.organizationId = req.session.organizationId;
  next();
};
export default middleware;
```

Execution order is deterministic:

1. Global Express middleware.
2. At each matched directory, outer to inner: `middleware.ts`, then layout `middlewares` in array order.
3. Endpoint `middlewares` from the selected page or raw route.
4. For pages: layout loaders outer to inner, page loader, metadata resolution, then RSC rendering. For raw endpoints: the HTTP handler.

Every matched middleware completes **before any loader or component starts**. Layout guards run again for server navigations even when React preserves the layout's browser state. Route/page-level middleware is endpoint-local; it does not inherit into descendants. Middleware receives decoded matched params. A handler that responds or redirects stops the branch.

### Page loaders

```tsx
// app/users/[id]/page.tsx
import type { PageLoader, PageProps } from "@opentyped/vite-express-rsc";

export const loader = (async (req, res) => {
  const user = await db.users.find(req.params.id);
  if (!user) throw new Response("Not found", { status: 404 });
  res.cookie("last-user", user.id);
  return { user };
}) satisfies PageLoader;

export default function Page({ loaderData }: PageProps<typeof loader>) {
  return <h1>{loaderData.user.name}</h1>;
}
```

Loaders receive the actual Express `req` and `res`. Their **return value supplies data**; this differs from native Express handlers, whose return value is ignored. Layouts have the same loader API. A page receives its own loader's data; React Router's matches also expose ancestor data. Async server components can still query services directly when a loader is unnecessary.

Loader return values are included in React Router's browser payload, even when the page component itself runs only on the server. Return only data safe for the browser; keep credentials, service objects, and sensitive server-only records out of loader results. Fetch directly inside a server component when only its rendered output should cross the boundary.

Loaders execute in ancestor order, not in parallel. They currently rerun for the matched page branch on each server navigation; selective revalidation optimization is not implemented. Shared middleware is the authorization boundary, rather than relying on a parent loader's timing.

`res.status()`, headers, cookies, and `res.redirect()` are staged before commitment. Redirects and thrown Fetch Responses pass through React Router's official response handling, so document redirects and `.rsc` navigation redirects behave correctly. A loader must return data rather than call `res.json()`, `res.send()`, or `res.end()`; those produce a diagnostic directing the author to `route.ts`. UI middleware can block with an error response, which becomes a route error; UI code cannot stream with `res.write()` or commit with `res.writeHead()`.

### Metadata

Both layouts and pages support a static object or an async/synchronous function:

```tsx
// app/layout.tsx
export const metadata = {
  title: { default: "My application", template: "%s · My application" },
  description: "Application description",
  openGraph: { siteName: "My application", images: ["/default.png"] },
};
```

```tsx
// app/users/[id]/page.tsx
import type { MetadataFunction } from "@opentyped/vite-express-rsc";

export const metadata = (async ({ loaderData, params, parent }) => ({
  title: loaderData.user.name,
  description: `Profile ${params.id}`,
  canonical: `/users/${params.id}`,
  openGraph: { images: [loaderData.user.avatarUrl] },
  robots: { index: false, follow: false },
})) satisfies MetadataFunction<typeof loader>;
```

Metadata resolves on the server after successful loaders, parent to child, before streaming. Metadata/loader/middleware exports must live in server modules: a `"use client"` page or layout cannot export them. Put those exports in a server wrapper/ancestor and import the interactive client component. The plugin diagnoses this combination. Native Express `route.ts`, `routes.tsx`, and `middleware.ts` modules cannot declare `"use client"` at all.

The nearest ancestor title template formats descendant titles; a layout can establish a new template. Scalars override, nested objects merge by field, arrays replace, `undefined` inherits, and `null` removes an inherited field. `parent` contains the resolved ancestor metadata. Metadata is skipped when preflight loading fails.

Supported fields are title/default/template, description, canonical, robots, and Open Graph title/description/url/type/siteName/images. One set of React 19 metadata elements is emitted at the page, avoiding duplicate layout titles. React manages these tags during navigation, including removal of stale tags. Metadata functions and their server imports are not sent to the browser. This is a small explicit schema, not a complete SEO/JSON-LD/Twitter metadata system. Do not also hardcode competing managed titles/meta tags in layouts.

### Raw Express endpoints

```ts
// app/users/[id]/export/route.ts
import type { RequestHandler } from "express";

export const middlewares = requireExportPermission;
export const GET: RequestHandler = async (req, res) => {
  res.type("text/csv").send(await exportUser(req.params.id));
};
```

GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS use native Express handling, with automatic GET-to-HEAD behavior and OPTIONS unless explicitly exported. Body parsing remains application-owned. Params survive the middleware/router bridge; handlers retain query/body/original URL access. The endpoint router's relative path is `/`, with the matched URL in `baseUrl`/`originalUrl`.

Unmatched raw methods call Express `next()`; no JSON 404 or synthetic 405 is imposed. UI-only unsupported methods return 405. Put custom raw error/fallthrough middleware after `appRouter` if needed. Use ordinary anchors for raw downloads, rather than asking an RSC `<Link>` to decode a raw response.

### Loading and errors

```tsx
// app/reports/loading.tsx
export default function Loading() {
  return <p>Loading report…</p>;
}
```

```tsx
// app/reports/error.tsx
import type { ErrorProps } from "@opentyped/vite-express-rsc";

export default function ErrorBoundary({ error }: ErrorProps) {
  return <p>Unable to load this report.</p>;
}
```

`loading.tsx` wraps the segment in Suspense and covers async component rendering. It is not shown while authorization, loaders, or metadata are still pending: those finish before rendering begins. `error.tsx` is connected to React Router's RSC ErrorBoundary handling. A root boundary replaces the root layout and should provide a complete document if required. Client boundaries can use `"use client"` for interactive recovery.

Raw handler failures use Express error middleware. Errors after HTML streaming commits cannot reliably change the HTTP status; production errors can have sanitized messages. `not-found.tsx` is not implemented; throw a 404 Response from a loader or use the route error boundary.

## Request context and security

Express middleware can set `res.locals.user`, `requestId`, and `services`. `getRequestContext()` from the package's `context` export reads these with request headers inside loaders, metadata functions, and server components, including asynchronous rendering. It also exposes an abort `signal` so server-side work can respond to client disconnects. Raw `req/res` objects are not exposed to components by this helper.

The RSC graph owns its request-local AsyncLocalStorage. SSR receives a serialized component response, not an assumption that a singleton crosses environments. Context objects are shallow: supplied mutable service/user objects can still be shared across requests. Concurrent identity isolation is tested; application service safety is still your responsibility.

The example's `x-user` identity is a test fixture, not production authentication. Session storage, authorization, input validation, CSRF protection for cookie-authenticated raw endpoints, and rate limiting are application-owned. Protected component modules should not perform sensitive work as import-time side effects: modules must load to obtain their middleware declarations.

Server Actions and UI mutation handlers are disabled. Use `route.ts` for mutations. There is no automatic UI revalidation after raw mutations; explicitly refetch/revalidate. The database example is an async stub, and its marker is checked against browser output. The marker check is not a general secret-leak detector. Mark sensitive modules with `import "server-only"`: the upstream RSC plugin rejects imports into the browser graph, and a real Vite build test verifies that boundary. File and directory names alone do not make a module server-only.

## Development and production limitations

Convention/server edits restart Vite and Express in the same process and close active sockets after Vite accepts the new configuration. Invalid route syntax leaves the existing listener alive; repairing the file is covered by the development regression suite. In-flight requests or browser module downloads can fail during edits. Ordinary client component edits use React refresh; persistent layouts are tested across navigation, rather than full server restarts. Polling runs every 100 ms. There is no automatic cleanup for application database pools, timers, subscriptions, or workers, and production graceful shutdown is application-owned.

One application/listener per Vite process is supported. The dev HMR port follows `PORT` and must match the application's actual listen port. Custom WebSocket handling, clusters, edge/serverless runtimes, custom Vite output directories, non-root base paths, and CDN asset prefixes are not supported. Non-default `base` and `build.outDir` fail at configuration time. The Express entry executes in the ordinary React/SSR environment and calls the RSC entry through Vite's environment-loading bridge. Page rendering and native filesystem endpoint modules execute in the RSC environment. React-dependent raw endpoint modules still inherit its `react-server` condition; separating those modules remains an integration limitation.

Deploy the entire `dist` tree (`index.js`, `rsc`, `ssr`, `client`) with declared runtime dependencies and an ESM package.json. It is not a standalone single-file executable. Production needs no Vite server or filesystem route discovery. A packed tarball is installed outside the workspace and used to typecheck and build the example. A separate deployment contains only `dist`, an ESM package manifest, and production dependencies; tests verify HTML, RSC responses, browser assets, and native endpoints without source files, the plugin, or Vite installed.

Only exact TypeScript convention filenames are recognized. There is no MDX, optional/mixed/parallel/intercepted routing, generated parameter types, arbitrary route-module export forwarding, or application-level caching policy. Configure private/no-store caching for personalized output, and choose CSP/nonces, compression, and production asset caching deliberately. Renderer transport tests cover backpressure and cancellation; sustained load and resource-leak testing remain future work.

Tested pins: Vite 8.3.5, plugin-rsc 0.5.38, plugin-react 6.0.1, React/React DOM/RSC transport 19.2.8, React Router 8.5.0, Express 5.2.1. RSC APIs remain experimental. The implementation reuses the [official Data Mode primitives](https://reactrouter.com/how-to/react-server-components) and [Vite RSC environments](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc). Update and test these packages together.

## Migrating the earlier proof of concept

Replace `app: { directory }, api: { directory }` with one `directory`. Move raw endpoints into that tree (for example `app/api/`). Remove the separate `apiRouter` import/mount. Replace `mount(router)` with a named `middlewares` handler/array, and replace directory middleware's named mount with its default request handler. The plugin diagnoses old `mount()` exports. Import `appRouter` directly from `@opentyped/vite-express-rsc/app`; remove the editor-only `app/index.ts` shim. No user data migration is involved.

## OAPI source parser

`packages/oapi` provides the optional `@opentyped/vite-express-rsc-oapi` compiler integration. It discovers annotated native Express handlers in `route.ts` and `routes.tsx`, derives URL paths, and supplies OAPI declarations for OpenAPI and TypeScript artifact generation. It never executes route modules or middleware. See [parser usage and limitations](packages/oapi/README.md).

## Verification and code quality

```sh
npx playwright install chromium
npm run check
npm test
```

`check` runs ESLint with zero warnings, TypeScript, and Prettier. Use `npm run format` or `npm run lint:fix` to apply fixes. ESLint covers JS/TS, React Hooks, mandatory braces, and statement spacing, with formatting delegated to Prettier; the separate `linter.toml` checks repository structure. Type-aware ESLint rules are not enabled; tsc checks types.

Tests build the example and repository root from clean output, start each production entry, and exercise dev mode. Coverage includes HTML/RSC requests, hydration, navigation/layout persistence, all HTTP methods, params/body/query handling, inherited guards on pages and raw descendants, denial before loading/rendering, cookies and redirects, loaders, metadata inheritance/removal, Suspense/error boundaries, conflict diagnostics, request isolation, browser bundle exclusion, and live updates. Fixture edits are restored; do not run a competing dev process editing them.

Set `PLAYWRIGHT_EXECUTABLE_PATH` for an existing Chromium installation. Restricted macOS hosts may need `PLAYWRIGHT_SINGLE_PROCESS=1`.

### Native handler annotations

`routes.tsx` is the preferred raw endpoint filename; `route.ts` remains an alias. Use only one per directory. Neither becomes a React page. Import the router directly from `@opentyped/vite-express-rsc/app`; no `app/index.ts` shim is required.

```ts
import type { RequestHandler } from "express";

export const middlewares = [requireSession];
export const GET: RequestHandler<{ id: string }, { order: string[] }> = (
  _req,
  res,
) => {
  res.json({ order: res.locals.order });
};
GET.middlewares = [loadOrder];
GET.openapi = {
  operationId: "getOrder",
  description: "Read the authenticated user's order",
  responses: { "200": { description: "Order found" } },
};
```

Execution order is global Express middleware, ancestor directory/layout middleware, module `middlewares`, selected method `middlewares`, then the method handler. Method middleware uses ordinary `next`, errors, and native responses. Implicit HEAD inherits GET middleware; explicit HEAD has its own stack. Automatic OPTIONS does not execute GET or POST middleware. Attach annotations during module initialization; sharing one function across exports also shares its annotations.

Include `@opentyped/vite-express-rsc/types` in your TypeScript project to augment Express's `RequestHandler`. Its generic arguments retain Express semantics: parameters, response body, request body, query, locals. The first argument does not describe the request body.

`openapi` is a typed, optional OpenAPI 3.1 operation annotation (`Partial<OperationObject>`). It stays attached to the handler. This proof of concept does not generate an OpenAPI document, serve documentation, validate payloads, enforce security declarations, or infer TypeScript types from schemas. Supply `responses` and other required operation fields before incorporating annotations into a complete document. Page `metadata` still controls HTML metadata independently.

### Compilation scope

The plugin compiles the application and supplies routing/RSC adapters. Your application owns the Express listener, signal handling, graceful shutdown, resource disposal, and deployment supervision. There is no package server lifecycle API. Install the plugin and Vite as development dependencies; their pure JavaScript adapter dependencies are bundled into server output, while native/Node dependencies such as Express may remain external.

`tests/deployment.test.ts` packs the plugin, installs it into an isolated application, typechecks without `skipLibCheck`, builds, and executes a separate source-free deployment with production dependencies only. Its installs use npm's offline cache populated by the initial workspace install.

The adapter uses React Router 8.5.0, which includes the upstream HTML payload-injection cancellation fix. Tests verify streamed document cancellation and a subsequent successful request in dev and production. Node's stream pipeline handles backpressure and cancels the renderer on disconnect; HEAD bodies are canceled rather than left unconsumed. This adapter does not manage the Express listener or process lifecycle. Stale-client version handling and nonce-based CSP integration remain pending production work.

### Package development

Both packages are implemented in TypeScript. `npm run build:packages` runs TypeScript compilation and emits JavaScript plus generated declarations into each package's `dist/`. Package exports and the CLI reference those built files; published tarballs contain compiled output rather than source implementations. The workspace install builds packages automatically, as do the root dev/build/test/typecheck commands. `npm pack` also builds the package before packing it.

Tests and ESLint configuration are TypeScript too. Tests use Node's type stripping and remain part of the strict TypeScript check; ESLint loads its TypeScript config through Jiti. Ambient module declarations describe Vite's virtual module; the public plugin and parser declarations are generated from their implementations.

## npm releases

Branch pushes and pull requests run `npm run check`. Pushing a `vX.Y.Z` tag
sets all publishable workspace versions and internal dependencies from the tag,
runs the checks, and publishes validated tarballs to npm. Prerelease tags such
as `v1.0.0-beta.1` use npm's `next` dist-tag; stable versions use `latest`.
Configure the repository Actions secret `NPM_TOKEN` with npm publishing access
to `@opentyped`. Credentials are supplied only to the publish step.

```sh
git tag v0.1.0
git push origin HEAD
git push origin v0.1.0
```

Use a new version for every release; npm versions cannot be overwritten.
