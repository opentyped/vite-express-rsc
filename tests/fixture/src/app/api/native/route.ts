import { createContext, createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RequestHandler } from "express";
import { setTimeout } from "node:timers/promises";
import { getRequestContext } from "express/rsc/context";

const Identity = createContext("");

/** Render through ordinary React APIs inside a native Express endpoint. */
function IdentityLabel() {
  return createElement("span", null, useContext(Identity));
}

/** Show that asynchronous native handlers retain their own request context. */
export const GET: RequestHandler = async (_req, res) => {
  const initial = getRequestContext();

  await setTimeout(10);

  const current = getRequestContext();

  res.json({
    requestId: current.locals.requestId,
    user: current.locals.user.id,
    stable: initial === current,
    markup: renderToStaticMarkup(
      createElement(
        Identity.Provider,
        { value: current.locals.requestId },
        createElement(IdentityLabel),
      ),
    ),
  });
};
