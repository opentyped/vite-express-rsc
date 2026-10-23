import { getRequestContext } from "express/rsc/context";

/** Create application-owned counters for checking that guards prevent work. */
export function createProbe() {
  return { layoutLoads: 0, pageLoads: 0, metadataCalls: 0, renders: 0 };
}

/** Read the same Express-owned counters from either server environment. */
export function getProbe() {
  return getRequestContext().locals.services.probe;
}
