# Vite + Express RSC

React server/client components and filesystem routes, compiled by Vite and served by your Express app.

## Install

```sh
npm install express react react-dom react-router
npm install -D vite typescript @types/express @types/react @types/react-dom @opentyped/vite-express-rsc
```

## Configure

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { expressRsc } from "@opentyped/vite-express-rsc";

export default defineConfig({
  plugins: [expressRsc({ directory: "./src/app" })],
});
```

```ts
// src/index.ts — your Express application
import express from "express";
import app from "express/rsc/bundle";

const server = express();
server.use(express.json());
server.use(app);
server.listen(3000);
```

```json
{
  "scripts": {
    "dev": "express-rsc",
    "build": "vite build",
    "start": "node dist/index.js"
  }
}
```

`express/rsc/bundle` is the compiled handler of the route directory. Pass `name: "admin"` to import it as `express/rsc/bundle/admin` instead; an unknown name fails the build. The Node entry defaults to `src/index.ts`; override it with Vite's `build.rollupOptions.input`.

```json
// tsconfig.json — declares express/rsc, express/rsc/context and express/rsc/bundle
{
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "types": ["node", "vite/client", "@opentyped/vite-express-rsc/types"]
  }
}
```

## Pages and layouts

```tsx
// src/app/page.tsx
import type { Request, Response } from "express";
import type { PageProps } from "express/rsc";

export async function loader(req: Request, res: Response) {
  return { user: res.locals.user };
}

export const metadata = { title: "Home" };

export default function Page({ loaderData }: PageProps<typeof loader>) {
  return <h1>Hello {loaderData.user?.name ?? "guest"}</h1>;
}
```

```tsx
// src/app/layout.tsx
import { Outlet } from "react-router";

export default function Layout() {
  return (
    <html>
      <head />
      <body>
        <Outlet />
      </body>
    </html>
  );
}
```

## Request context

Components and handlers read per-request values without receiving `res`:

```ts
import { getRequestContext } from "express/rsc/context";

const { locals, signal, url, headers, nonce } = getRequestContext();
```

`locals` is your `res.locals`; type it by augmenting `Express.Locals`. `signal` aborts on client disconnect. Set `res.locals.nonce` to apply a CSP nonce to rendered scripts.

Add `"use client"` to interactive components. Server components can import database/services directly; the route directory is the browser boundary, so a client import of any other project file (or of a `route.ts`/`middleware.ts`) fails the build. Loader results are sent to the browser: return only public data.

## Middleware and endpoints

```ts
// src/app/orders/[id]/route.ts — routes.tsx also works
import type { RequestHandler } from "express";

export const middlewares = [requireSession];

export const GET: RequestHandler<{ id: string }, Order> = (_req, res) => {
  res.json(res.locals.order);
};

GET.middlewares = [loadOrder];
GET.openapi = {
  operationId: "getOrder",
  responses: { "200": { description: "Order found" } },
};
```

A directory's `middleware.ts` exports a default Express handler. Layout `middlewares` protect all descendants; page/route middleware protects that endpoint. Guards finish before loaders or rendering.

The directory compiles to an ordinary Express `Router`: each folder becomes `router.route(path)`, registered static-first, so Express does matching, params, `next()`, HEAD, and OPTIONS. `[id]` creates a dynamic segment, `(group)` is pathless, and `[...slug]` is a required catch-all (`params.slug` is `"a/b"` in pages, `["a","b"]` in Express handlers). Unmatched document URLs fall through to your Express 404 handler; a non-GET request to a page URL gets `405`. `loading.tsx` supplies a rendering Suspense fallback; `error.tsx` supplies a route error boundary. Ordinary component files are not routes.

## Run

```sh
npm run dev
npm run build && node dist/index.js
```

Deploy the entire `dist` directory with production dependencies. Express owns authentication, sessions, validation, caching, and shutdown. No Server Actions are required.

Requires Node 22.22+. RSC integrations use experimental upstream APIs. Vite `base` must be `/` (mount the handler at a path instead; sub-path mounting is untested). `npm run dev` restarts the process when the entry or its own imports change; route edits update in place. The implementation is still being hardened; a successful build alone does not establish production readiness.

## OpenAPI

Annotate native handlers with `GET.openapi` (strict OpenAPI 3.2 types), then generate `openapi.json` and typed declarations with the [OAPI parser](packages/oapi). It reads source only and documents exactly the paths the router serves.

See [the example](examples/basic): a todo app with pages, a client form, API routes, and a generated OpenAPI document served at `/api/openapi`.
