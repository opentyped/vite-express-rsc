# Filesystem Express parser for OpenTyped OAPI

This package adapts the RSC plugin's `route.ts` and `routes.tsx` conventions to
OAPI's parser pipeline. It reads TypeScript source; it never imports route
modules or executes middleware and handlers.

It takes its route list from the plugin's own scanner
(`@opentyped/vite-express-rsc/routes`), so documented paths are exactly the
paths Express serves, with the same conflict rules.

```ts
// scripts/openapi.ts
import { writeFileSync } from "node:fs";
import { generate } from "@opentyped/oapi-compiler";
import { generateDefinitions } from "@opentyped/oapi-tsgen";
import {
  defaultParsers,
  filesystemParsers,
} from "@opentyped/vite-express-rsc-oapi";

const { document } = generate(
  {
    tsconfig: "tsconfig.json",
    info: { title: "Application", version: "1.0.0" },
    parsers: filesystemParsers({ directory: "src/app" }, defaultParsers()),
  },
  defaultParsers,
);

writeFileSync("openapi.json", JSON.stringify(document, null, 2));
writeFileSync("openapi.d.ts", generateDefinitions(document));
```

The parser provides OAPI `ModelDeclaration` objects. OAPI's normal schema,
document and declaration generators produce the artifacts. The wrapper places
filesystem discovery before other discovery steps, and annotation merging after
the document emitter. All supplied parsers receive an isolated checked project
context; the compiler's cached project remains unchanged. Use the wrapper for custom
pipelines too.

```ts
// src/app/orders/[id]/route.ts
import type { RequestHandler } from "express";

export const middlewares = [requireSession];

export const GET: RequestHandler<{ id: string }, Order> = (req, res) => {
  res.json(findOrder(req.params.id));
};
GET.middlewares = [requireOrderAccess];
GET.openapi = {
  operationId: "getOrder",
  description: "Read an order",
  security: [{ session: [] }],
  responses: { "200": { description: "Order found" } },
};
```

The inferred path is `/orders/{id}`. `(group)` directories add no URL segment.
Set `prefix: "/internal"` if the Express application mounts this tree there.
OAPI's normal configuration must define referenced security schemes.

Only exported HTTP methods with an explicit `.openapi` assignment are documented.
The assignment must appear once, unconditionally, at module scope. Metadata may
be a static object or a statically resolvable `const` reference. Static JSON is
read without evaluating application expressions. RequestHandler import aliases
and local export aliases work; handler declarations must remain in the route
module.

Express generics retain their native meaning:
`RequestHandler<Params, ResponseBody, RequestBody, Query, Locals>`.
The first two arguments are required for documented handlers; body and query
schemas are included when their arguments are explicitly supplied. Empty params
objects are omitted. Locals and middleware are implementation details and do not
produce schemas or inferred security requirements. Use OAPI's strict type policy
to catch unresolved `any`/`unknown` contracts.

The response type describes JSON status 200. The parser does not inspect
`res.status()`, infer alternate response codes, execute validation, or document
implicit HEAD/OPTIONS handlers. Annotation objects merge into generated
operations: response descriptions can extend inferred response schemas, arrays
replace earlier arrays, and additional statuses require explicit documentation.
Annotations do not move the inferred 200 schema to a different status.

Catch-all routes are rejected when annotated because OpenAPI path parameters
cannot accurately describe a multi-segment wildcard. Pages, layouts, HTML
metadata, loading/error components and unannotated handlers are ignored.
Filesystem route conflicts and duplicate annotations fail generation.

Checked input aliases are added in memory to the TypeScript
program; application files are never rewritten. Filename-derived component
names escape characters such as brackets and parentheses, with collisions
reported. Custom namespace rules still follow OAPI's own restrictions. This
integration is pinned to the reviewed OAPI and TypeScript versions; it is not a
runtime dependency of the Express application.
