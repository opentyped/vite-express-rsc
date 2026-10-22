import { AsyncLocalStorage } from "node:async_hooks";
import type { Definition, ResolvedMetadata } from "./types.js";

export interface RenderState {
  results: Map<string, unknown>;
  metadata: ResolvedMetadata;
  terminal?: unknown;
  terminalId?: string;
  params: Record<string, string | undefined>;
  page?: Definition;
}

export const rendering = new AsyncLocalStorage<RenderState>();

export function getRenderState() {
  const state = rendering.getStore();

  if (!state) {
    throw new Error("Page rendering requires a request state");
  }

  return state;
}
