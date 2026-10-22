import type { Request, Response } from "express";
import { matchRoutes, type RouteObject } from "react-router";
import { handlers, middleware, load, setParams } from "./express.js";
import { resolveMetadata } from "./metadata.js";
import type { Definition, RouteModule, PageProps } from "./types.js";
import { getRequestContext } from "./context.js";
import type { RenderState } from "./state.js";

export interface Branch {
  definition: Definition;
  params: Record<string, string | undefined>;
}

export function matchDefinitions(
  definitions: Definition[],
  pathname: string,
): Branch[] {
  const tree = (definition: Definition): RouteObject => {
    const children = definition.children.map(tree);

    if (
      definition.path !== "*" &&
      (definition.files["page.tsx"] || definition.files["route.ts"])
    ) {
      children.unshift({
        id: `endpoint:${definition.id}`,
        index: true,
        handle: definition,
      });
    }

    return {
      id: definition.id,
      ...(definition.path ? { path: definition.path } : {}),
      handle: definition,
      children,
    };
  };

  const seen = new Set<string>();

  return (matchRoutes(definitions.map(tree), pathname) ?? []).flatMap(
    (match) => {
      const definition = match.route.handle as Definition;

      if (seen.has(definition.id)) {
        return [];
      }

      seen.add(definition.id);

      return [{ definition, params: match.params }];
    },
  );
}

export async function modules(branch: Branch[]) {
  const layouts = [];

  for (const { definition, params } of branch) {
    const files = definition.files;

    layouts.push({
      definition,
      params,
      middleware: files["middleware.ts"]
        ? await files["middleware.ts"].load()
        : undefined,
      layout: files["layout.tsx"]
        ? await files["layout.tsx"].load()
        : undefined,
    });
  }

  const last = branch.at(-1)?.definition;

  return {
    layouts,
    page: last?.files["page.tsx"]
      ? await last.files["page.tsx"].load()
      : undefined,
    route: last?.files["route.ts"]
      ? await last.files["route.ts"].load()
      : undefined,
  };
}

export async function prepare(
  req: Request,
  res: Response,
  loaded: Awaited<ReturnType<typeof modules>>,
  state: RenderState,
  ui: boolean,
) {
  const metadataModules: { module: RouteModule; props: PageProps }[] = [];
  const pageId = state.page?.id.replace(/^layout:/, "page:");

  try {
    // Finish every ancestor guard before starting any loader or component.
    for (const {
      definition,
      params,
      middleware: directory,
      layout,
    } of loaded.layouts) {
      state.terminalId =
        definition.path === "*" && definition.files["page.tsx"]
          ? definition.id.replace(/^layout:/, "page:")
          : definition.id;
      setParams(req, params);

      if (directory && typeof directory.default !== "function") {
        throw new Error(
          `middleware.ts must default-export an Express handler: ${definition.id}`,
        );
      }

      const stack = [
        ...(directory
          ? [directory.default as import("express").RequestHandler]
          : []),
        ...handlers(layout?.middlewares),
      ];
      const response = await middleware(req, res, stack, ui);

      if (response) {
        state.terminal = response;

        return;
      }
    }

    state.terminalId = pageId;
    setParams(req, state.params);

    const response = await middleware(
      req,
      res,
      handlers(ui ? loaded.page?.middlewares : loaded.route?.middlewares),
      ui,
    );

    if (response) {
      state.terminal = response;

      return;
    }

    if (!ui || !loaded.page || !["GET", "HEAD"].includes(req.method)) {
      return;
    }

    Object.assign(getRequestContext(), {
      requestId: res.locals.requestId ?? getRequestContext().requestId,
      user: res.locals.user,
      services: res.locals.services,
      nonce: res.locals.nonce,
    });

    for (const { definition, params, layout } of loaded.layouts) {
      if (!layout) {
        continue;
      }

      state.terminalId =
        definition.path === "*" && definition.files["page.tsx"]
          ? definition.id.replace(/^layout:/, "page:")
          : definition.id;
      setParams(req, params);

      const value = layout.loader
        ? await load(req, res, layout.loader)
        : undefined;

      if (value instanceof globalThis.Response) {
        throw value;
      }

      state.results.set(definition.id, value);
      metadataModules.push({
        module: layout,
        props: { loaderData: value, params },
      });
    }

    state.terminalId = pageId;
    setParams(req, state.params);

    const value = loaded.page?.loader
      ? await load(req, res, loaded.page.loader)
      : undefined;

    if (value instanceof globalThis.Response) {
      throw value;
    }

    if (pageId) {
      state.results.set(pageId, value);
    }

    if (loaded.page) {
      metadataModules.push({
        module: loaded.page,
        props: { loaderData: value, params: state.params },
      });
    }

    state.metadata = await resolveMetadata(metadataModules);
    state.terminalId = undefined;
  } catch (error) {
    state.terminal =
      error ?? new Error("Request processing threw an empty error");
  }
}
