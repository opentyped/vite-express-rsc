// Module names the plugin provides at build time. Add
// "@opentyped/vite-express-rsc/types" to tsconfig `types` so editors and tsc
// know them too. This file is a script, so its declarations are global.

/** Page, layout, and endpoint types. Type-only: nothing is bundled. */
declare module "express/rsc" {
  export type {
    PageLoader,
    PageProps,
    LoaderData,
    Middlewares,
    Metadata,
    ResolvedMetadata,
    MetadataFunction,
    OpenAPIOperation,
    ErrorProps,
    RequestContext,
  } from "@opentyped/vite-express-rsc";
}

/** Request values for server components and handlers. */
declare module "express/rsc/context" {
  export type { RequestContext } from "@opentyped/vite-express-rsc";

  /** Read the current request values; fails outside a routed request. */
  export function getRequestContext(): import("@opentyped/vite-express-rsc").RequestContext;
}

/** The compiled Express handler of the default route directory. */
declare module "express/rsc/bundle" {
  const handler: import("express").RequestHandler;
  export default handler;
}

/** The compiled Express handler of a named route directory. */
declare module "express/rsc/bundle/*" {
  const handler: import("express").RequestHandler;
  export default handler;
}
