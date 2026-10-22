import { Suspense, createElement, type ComponentType } from "react";
import {
  Outlet,
  type unstable_RSCRouteConfig as RouteConfig,
} from "react-router";
import { getRenderState } from "./state.js";
import { MetadataTags } from "./metadata.js";
import type {
  Definition,
  ErrorProps,
  PageProps,
  RouteModule,
} from "./types.js";

export function createRoutes(definitions: Definition[]): RouteConfig {
  const create = (definition: Definition): RouteConfig[number] => {
    const { files, id } = definition;
    const lazy = async (page: boolean) => {
      const module = page
        ? await files["page.tsx"].load()
        : files["layout.tsx"]
          ? await files["layout.tsx"].load()
          : ({} as RouteModule);
      const Component = module.default as ComponentType<PageProps> | undefined;
      const loading =
        (!page || definition.path === "*") && files["loading.tsx"]
          ? ((await files["loading.tsx"].load())
              .default as ComponentType<PageProps>)
          : undefined;
      const boundary =
        (!page || definition.path === "*") && files["error.tsx"]
          ? ((await files["error.tsx"].load())
              .default as ComponentType<ErrorProps>)
          : undefined;

      return {
        loader() {
          const state = getRenderState();
          const routeId = page ? id.replace(/^layout:/, "page:") : id;

          if (
            state.terminal !== undefined &&
            (!state.terminalId || state.terminalId === routeId)
          ) {
            throw state.terminal;
          }

          return state.results.get(routeId) ?? null;
        },
        Component(props: PageProps) {
          const state = getRenderState();
          const routeId = page ? id.replace(/^layout:/, "page:") : id;
          const denied = state.terminalId;
          const directory = id.slice("layout:".length);
          const deniedDirectory = denied?.slice("layout:".length);

          // RSC may serialize the errored route's normal element as well as its error element.
          // Never invoke protected components merely because the browser will discard their output.
          if (
            state.terminal !== undefined &&
            (!denied ||
              routeId === denied ||
              (denied.startsWith("layout:") &&
                (deniedDirectory === "" ||
                  directory === deniedDirectory ||
                  directory.startsWith(deniedDirectory + "/"))))
          ) {
            return <Outlet />;
          }

          const element = Component ? (
            createElement(Component, props)
          ) : (
            <Outlet />
          );
          const content = page ? (
            <>
              <MetadataTags value={state.metadata} />
              {element}
            </>
          ) : (
            element
          );

          return loading ? (
            <Suspense
              fallback={createElement(loading, {
                loaderData: undefined,
                params: props.params,
              })}
            >
              {content}
            </Suspense>
          ) : (
            content
          );
        },
        ...(boundary
          ? {
              ErrorBoundary(props: ErrorProps) {
                return (
                  <>
                    <MetadataTags value={getRenderState().metadata} />
                    {createElement(boundary, props)}
                  </>
                );
              },
            }
          : {}),
      };
    };

    const children = definition.children.map(create);

    if (files["page.tsx"]) {
      children.unshift({
        id: id.replace(/^layout:/, "page:"),
        index: true,
        lazy: () => lazy(true),
      });
    }

    // A splat page must render at the splat route itself, rather than its index.
    if (definition.path === "*" && files["page.tsx"]) {
      if (definition.children.length || files["layout.tsx"]) {
        throw new Error(
          `Catch-all page cannot have a layout or route descendants: ${id}`,
        );
      }

      return {
        id: id.replace(/^layout:/, "page:"),
        path: "*",
        lazy: () => lazy(true),
      };
    }

    return {
      id,
      ...(definition.path ? { path: definition.path } : {}),
      lazy: () => lazy(false),
      children,
    };
  };

  return definitions.map(create);
}
