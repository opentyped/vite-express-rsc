import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** Aborted when the client disconnects before the response finishes. */
  signal: AbortSignal;
  /** Absolute request URL, using Express's `trust proxy` setting. */
  url: URL;
  headers: Headers;
  /** The application's `res.locals`; augment `Express.Locals` to type it. */
  locals: Express.Locals;
  /** CSP nonce taken from `res.locals.nonce`, when the application sets one. */
  nonce?: string;
}

// Each Vite environment bundles its own copy of this module. The router enters
// both copies explicitly with the same object, so no instance is shared implicitly.
const storage = new AsyncLocalStorage<RequestContext>();

/** Read the current request values; fail outside a routed request. */
export function getRequestContext(): RequestContext {
  const context = storage.getStore();

  if (!context) {
    throw new Error(
      "Request context is only available while handling a route from the configured directory",
    );
  }

  return context;
}

/** Run a callback with the given request values. */
export function withRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}
