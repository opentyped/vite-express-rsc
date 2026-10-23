import { Suspense, createElement, type ComponentType } from "react";
import {
  Outlet,
  type unstable_RSCRouteConfig as RouteConfig,
} from "react-router";
import { getRenderState } from "./state.js";
import { MetadataTags } from "./metadata.js";
import type { ErrorProps, PageProps, RouteModule } from "./types.js";

type Load = () => Promise<RouteModule>;

/** One generated directory node from `virtual:express/rsc/routes`. */
export interface TreeNode {
  id: string;
  pageId: string;
  path: string;
  /** Parameter name of a `[...name]` catch-all. */
  splat?: string;
  page?: Load;
  layout?: Load;
  loading?: Load;
  error?: Load;
  children: TreeNode[];
}

/** Index page and layout modules by route id. */
export function flatten(root: TreeNode): Map<string, Load> {
  const result = new Map<string, Load>();

  /** Add one node and its descendants. */
  const visit = (node: TreeNode) => {
    if (node.page) {
      result.set(node.pageId, node.page);
    }

    if (node.layout) {
      result.set(node.id, node.layout);
    }

    node.children.forEach(visit);
  };

  visit(root);

  return result;
}

/** The directory part of a route id: `layout:a/b` and `page:a/b` give `a/b`. */
const directoryOf = (id: string) => id.slice(id.indexOf(":") + 1);

/**
 * Whether a guard or loader failure at `terminalId` hides route `routeId`. A
 * layout failure hides everything below that layout.
 */
function hidden(routeId: string, terminalId: string | undefined) {
  if (!terminalId || routeId === terminalId) {
    return true;
  }

  if (!terminalId.startsWith("layout:")) {
    return false;
  }

  const denied = directoryOf(terminalId);
  const own = directoryOf(routeId);

  return denied === "" || own === denied || own.startsWith(denied + "/");
}

/** Turn the generated tree into React Router routes with layouts and boundaries. */
export function createRoutes(root: TreeNode): RouteConfig {
  /** Build the lazy route module for a node's layout (or its page). */
  const lazy = async (node: TreeNode, page: boolean) => {
    const routeId = page ? node.pageId : node.id;
    const module = (await (page ? node.page : node.layout)?.()) ?? {};
    const Component = module.default as ComponentType<PageProps> | undefined;
    // Boundaries belong to the layout route, or to a catch-all page that has none.
    const owner = !page || node.path === "*";
    const loading =
      owner && node.loading
        ? ((await node.loading()).default as ComponentType<PageProps>)
        : undefined;
    const boundary =
      owner && node.error
        ? ((await node.error()).default as ComponentType<ErrorProps>)
        : undefined;

    return {
      /** Return the prepared loader data, or the failure that stopped this route. */
      loader() {
        const state = getRenderState();

        if (
          state.terminal !== undefined &&
          (!state.terminalId || state.terminalId === routeId)
        ) {
          throw state.terminal;
        }

        return state.results.get(routeId) ?? null;
      },
      /** Render the allowed route content with its metadata and loading fallback. */
      Component(props: PageProps) {
        const state = getRenderState();

        // RSC may serialize a failed route's element as well as its boundary.
        // Never run protected components whose output would be discarded.
        if (state.terminal !== undefined && hidden(routeId, state.terminalId)) {
          return <Outlet />;
        }

        const params = node.splat
          ? { ...props.params, [node.splat]: props.params["*"] }
          : props.params;
        const element = Component ? (
          createElement(Component, { ...props, params })
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
            fallback={createElement(loading, { loaderData: undefined, params })}
          >
            {content}
          </Suspense>
        ) : (
          content
        );
      },
      ...(boundary
        ? {
            /** Render the route error component with the current page metadata. */
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

  /** Build one route and its nested routes. */
  const create = (node: TreeNode): RouteConfig[number] => {
    // A catch-all page renders at the splat route itself, not as its index.
    if (node.path === "*" && node.page) {
      return { id: node.pageId, path: "*", lazy: () => lazy(node, true) };
    }

    const children = node.children.map(create);

    if (node.page) {
      children.unshift({
        id: node.pageId,
        index: true,
        lazy: () => lazy(node, true),
      });
    }

    return {
      id: node.id,
      ...(node.path ? { path: node.path } : {}),
      lazy: () => lazy(node, false),
      children,
    };
  };

  return [create(root)];
}
