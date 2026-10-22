import "../express.js";
import type { OpenAPIV3_1 } from "openapi-types";
import type { Request, Response, RequestHandler } from "express";

// An annotation may be incomplete while a route is being developed.
export type OpenAPIOperation = Partial<OpenAPIV3_1.OperationObject>;

export type Middlewares = RequestHandler | readonly RequestHandler[];

export type PageLoader<T = unknown> = (
  req: Request,
  res: Response,
) => T | Promise<T>;

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
  loader?: PageLoader;
  metadata?: Metadata | MetadataFunction;
  [key: string]: unknown;
}

export interface Definition {
  id: string;
  path: string;
  files: Record<string, { load(): Promise<RouteModule>; methods: string[] }>;
  children: Definition[];
}

export interface ErrorProps {
  error: unknown;
  params: Record<string, string | undefined>;
  loaderData?: unknown;
}
