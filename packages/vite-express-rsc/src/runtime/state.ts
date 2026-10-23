import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedMetadata } from "./types.js";

export interface RenderState {
  /** Loader results keyed by route id. */
  results: Map<string, unknown>;
  metadata: ResolvedMetadata;
  /** A guard response or error that replaces the protected content. */
  terminal?: unknown;
  /** Route id that produced `terminal`; React Router renders its nearest boundary. */
  terminalId?: string;
}

// React Router calls route loaders and components without our arguments, so the
// prepared results for this render travel through storage owned by this graph.
export const rendering = new AsyncLocalStorage<RenderState>();

/** Read the loader results, metadata, and errors for the current render. */
export function getRenderState() {
  const state = rendering.getStore();

  if (!state) {
    throw new Error("Page rendering requires a request state");
  }

  return state;
}
