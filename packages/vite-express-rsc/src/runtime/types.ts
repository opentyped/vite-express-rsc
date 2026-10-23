import "../express.js";
import type {
  OperationObject,
  ResponseObject,
  ReferenceObject,
} from "openapi3-ts/oas32";
import type { Request, Response, RequestHandler } from "express";

type StatusDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type StatusClass = "1" | "2" | "3" | "4" | "5";
type ResponseStatus =
  | `${StatusClass}${StatusDigit}${StatusDigit}`
  | `${StatusClass}XX`
  | "default";

type OperationResponses = {
  [status in ResponseStatus]?: ResponseObject | ReferenceObject;
} & {
  [extension: `x-${string}`]: unknown;
};

// Keep OpenAPI 3.2 fields intact and check response keys and values more strictly
// than the upstream ResponsesObject, whose string index accepts any value.
export type OpenAPIOperation = Omit<OperationObject, "responses"> & {
  responses?: OperationResponses;
};

export type Middlewares = RequestHandler | readonly RequestHandler[];

/**
 * A page or layout loader. `Params` types `req.params`: folder params such as
 * `[id]` are strings; pass `{ slug: string[] }` for a `[...slug]` catch-all.
 */
export type PageLoader<
  T = unknown,
  Params extends Record<string, string | string[]> = Record<string, string>,
> = (req: Request<Params>, res: Response) => T | Promise<T>;

export type LoaderData<T> = T extends (...args: never[]) => infer R
  ? Awaited<R>
  : T;

export interface PageProps<T = unknown> {
  loaderData: LoaderData<T>;
  params: Record<string, string | undefined>;
  matches?: unknown[];
}

export interface Metadata {
  title?: string | { default?: string; template?: string } | null;
  description?: string | null;
  canonical?: string | null;
  openGraph?: {
    title?: string | null;
    description?: string | null;
    url?: string | null;
    type?: string | null;
    siteName?: string | null;
    images?: readonly string[] | null;
  } | null;
  robots?: string | { index?: boolean; follow?: boolean } | null;
}

export type ResolvedMetadata = Omit<Metadata, "title"> & {
  title?: string | null;
};

export type MetadataFunction<T = unknown> = (
  args: PageProps<T> & { parent: Readonly<ResolvedMetadata> },
) => Metadata | Promise<Metadata>;

export interface RouteModule {
  default?: unknown;
  middlewares?: Middlewares;
  /** Called with the matched request; its params type is checked at the page. */
  loader?: (req: Request, res: Response) => unknown;
  metadata?: Metadata | MetadataFunction;
  [key: string]: unknown;
}

export interface ErrorProps {
  error: unknown;
  params: Record<string, string | undefined>;
  loaderData?: unknown;
}
