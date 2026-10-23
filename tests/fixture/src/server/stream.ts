import { getRequestContext } from "express/rsc/context";

/** Create application-owned counters for observing streaming cancellation. */
export function createStreams() {
  return { started: 0, completed: 0, canceled: 0 };
}

/** Read the same streaming counters from either server environment. */
export function getStreams() {
  return getRequestContext().locals.services.streams;
}
