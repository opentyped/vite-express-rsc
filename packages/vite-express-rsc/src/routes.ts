import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";

export const methods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

/** Convention filenames and the role each one plays in a directory. */
const conventions = {
  "page.tsx": "page",
  "layout.tsx": "layout",
  "middleware.ts": "middleware",
  "route.ts": "route",
  "routes.tsx": "route",
  "loading.tsx": "loading",
  "error.tsx": "error",
} as const;

type Role = (typeof conventions)[keyof typeof conventions];

/** One directory of the route tree. Ids match React Router route ids. */
export interface RouteNode {
  /** Layout route id, e.g. `layout:guarded`. */
  id: string;
  /** Page route id, e.g. `page:guarded`. */
  pageId: string;
  /** Directory relative to the route root, using `/`. */
  dir: string;
  /** React Router path segment: "", "users", ":id" or "*". */
  segment: string;
  /** Express path segment: "", "users", ":id" or "*slug". */
  expressSegment: string;
  files: Partial<Record<Role, string>>;
  /** Exported HTTP methods of the raw route module. */
  methods: string[];
  /** Whether layout.tsx / page.tsx export `middlewares`. */
  layoutMiddlewares: boolean;
  pageMiddlewares: boolean;
  children: RouteNode[];
}

/** One step of the inherited guard chain, outermost first. */
export interface Guard {
  /** Route id that owns this guard, used to place error boundaries. */
  id: string;
  /** Absolute path of the directory's middleware.ts. */
  middleware?: string;
  /** Layout id whose `middlewares` export runs here. */
  layout?: string;
}

/** One URL registered on the Express router. */
export interface Endpoint {
  /** Express path, e.g. `/users/:id` or `/docs/*slug`. */
  path: string;
  guards: Guard[];
  /** Page id rendered for GET/HEAD. */
  page?: string;
  pageMiddlewares?: boolean;
  /** Layout ids from the root to the page, used for loaders and metadata. */
  layouts: string[];
  /** Absolute path of route.ts / routes.tsx. */
  route?: string;
  methods: string[];
}

/** List files in a stable order so generated routes are repeatable. */
function discover(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) =>
      entry.isDirectory()
        ? discover(join(directory, entry.name)).map(
            (file) => `${entry.name}/${file}`,
          )
        : [entry.name],
    );
}

/** Turn a folder name into React Router and Express segments. */
function segmentOf(name: string): { segment: string; express: string } {
  if (/^\([\w-]+\)$/.test(name)) {
    return { segment: "", express: "" };
  }

  const splat = /^\[\.\.\.([A-Za-z_]\w*)\]$/.exec(name);

  if (splat) {
    return { segment: "*", express: "*" + splat[1] };
  }

  const param = /^\[([A-Za-z_]\w*)\]$/.exec(name);

  if (param) {
    return { segment: ":" + param[1], express: ":" + param[1] };
  }

  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Unsupported route segment: ${name}`);
  }

  return { segment: name, express: name };
}

/** Read export names and directives without executing application code. */
function exportsOf(file: string, role: Role): Set<string> {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  });
  const client = ast.program.directives.some(
    (directive) => directive.value.value === "use client",
  );

  if (client && (role === "route" || role === "middleware")) {
    throw new Error(
      `Express route and middleware modules cannot use the use-client directive: ${file}`,
    );
  }

  const names = new Set<string>();

  for (const statement of ast.program.body) {
    if (statement.type === "ExportAllDeclaration") {
      throw new Error(
        `Wildcard exports are not supported in convention modules: ${file}`,
      );
    }

    if (statement.type === "ExportDefaultDeclaration") {
      names.add("default");
    }

    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.exportKind === "type"
    ) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ExportSpecifier" &&
        specifier.exportKind !== "type"
      ) {
        names.add(
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value,
        );
      }
    }

    const declaration = statement.declaration;

    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (item.id.type !== "Identifier") {
          throw new Error(`Use named export bindings in ${file}`);
        }

        names.add(item.id.name);
      }
    } else if (
      declaration &&
      "id" in declaration &&
      declaration.id?.type === "Identifier"
    ) {
      names.add(declaration.id.name);
    }
  }

  if (
    client &&
    ["middlewares", "loader", "metadata"].some((name) => names.has(name))
  ) {
    throw new Error(
      `Server middleware, loaders, and metadata cannot be exported from a use-client module: ${file}`,
    );
  }

  if (names.has("action") || names.has("clientAction")) {
    throw new Error(
      `Actions are not supported; export HTTP methods from route.ts: ${file}`,
    );
  }

  return names;
}

/** Create an empty directory node. */
function node(dir: string, parent?: RouteNode): RouteNode {
  const name = dir.split("/").at(-1) ?? "";
  const { segment, express } = dir
    ? segmentOf(name)
    : { segment: "", express: "" };

  if (parent?.segment === "*") {
    throw new Error(`Catch-all routes cannot have child routes: ${dir}`);
  }

  return {
    id: "layout:" + dir,
    pageId: "page:" + dir,
    dir,
    segment,
    expressSegment: express,
    files: {},
    methods: [],
    layoutMiddlewares: false,
    pageMiddlewares: false,
    children: [],
  };
}

/** Scan the route directory into a validated tree. */
export function scan(directory: string): RouteNode {
  const root = node("");
  const nodes = new Map([["", root]]);

  for (const file of discover(directory)) {
    const parts = file.split("/");
    const filename = parts.pop()!;
    const role = conventions[filename as keyof typeof conventions];

    if (!role) {
      continue;
    }

    // Create every directory node between the root and this file.
    let current = root;

    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      let next = nodes.get(dir);

      if (!next) {
        next = node(dir, current);
        nodes.set(dir, next);
        current.children.push(next);
      }

      current = next;
    }

    const absolute = join(directory, file);
    const names = exportsOf(absolute, role);

    if (current.files[role]) {
      throw new Error(`Use only one raw route module per directory: ${file}`);
    }

    current.files[role] = absolute;

    if (role === "route") {
      current.methods = methods.filter((method) => names.has(method));

      if (!current.methods.length) {
        throw new Error(`Export an HTTP method from ${file}`);
      }
    } else if (!names.has("default")) {
      throw new Error(`Expected a default export in ${file}`);
    }

    if (role === "layout") {
      current.layoutMiddlewares = names.has("middlewares");
    }

    if (role === "page") {
      current.pageMiddlewares = names.has("middlewares");
    }
  }

  validate(root, []);

  return root;
}

/** Reject duplicate parameters and layouts that would hide a catch-all. */
function validate(current: RouteNode, params: string[]) {
  const name = current.segment.startsWith(":")
    ? current.segment.slice(1)
    : current.segment === "*"
      ? current.expressSegment.slice(1)
      : undefined;

  if (name && params.includes(name)) {
    throw new Error(`Duplicate dynamic parameter '${name}' in ${current.dir}`);
  }

  if (current.segment === "*" && current.files.layout) {
    throw new Error(
      `Catch-all routes must be leaves without a layout: ${current.id}`,
    );
  }

  for (const child of current.children) {
    validate(child, name ? [...params, name] : params);
  }
}

/** The React Router id of a node's own route; a catch-all page replaces its layout. */
export function routeIdOf(current: RouteNode): string {
  return current.segment === "*" && current.files.page
    ? current.pageId
    : current.id;
}

/** Rank a segment: static before dynamic before catch-all. */
const rank = (part: string) =>
  part.startsWith("*") ? 2 : part.startsWith(":") ? 1 : 0;

/** Order more specific paths first so Express matches them before broader ones. */
function compare(a: Endpoint, b: Endpoint): number {
  const left = a.path.split("/").filter(Boolean);
  const right = b.path.split("/").filter(Boolean);

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order =
      rank(left[i]) - rank(right[i]) || left[i].localeCompare(right[i], "en");

    if (order) {
      return order;
    }
  }

  return left.length - right.length;
}

/** Flatten the tree into Express registrations and reject conflicting URLs. */
export function endpoints(root: RouteNode): Endpoint[] {
  const result: Endpoint[] = [];
  const owners = new Map<string, RouteNode>();

  /** Visit one directory with the guards and layouts it inherits. */
  const visit = (
    current: RouteNode,
    path: string[],
    guards: Guard[],
    layouts: string[],
  ) => {
    const here = current.expressSegment
      ? [...path, current.expressSegment]
      : path;
    const own: Guard = { id: routeIdOf(current) };

    if (current.files.middleware) {
      own.middleware = current.files.middleware;
    }

    if (current.layoutMiddlewares) {
      own.layout = current.id;
    }

    const inherited = own.middleware || own.layout ? [...guards, own] : guards;
    const nested = current.files.layout ? [...layouts, current.id] : layouts;

    if (current.files.page || current.files.route) {
      const methods = current.methods;

      if (current.files.page && methods.includes("GET")) {
        throw new Error(
          `Conflicting routes (GET): ${current.files.page} and ${current.files.route}`,
        );
      }

      const endpoint: Endpoint = {
        path: "/" + here.join("/"),
        guards: inherited,
        layouts: nested,
        methods,
      };

      if (current.files.page) {
        endpoint.page = current.pageId;
        endpoint.pageMiddlewares = current.pageMiddlewares;
      }

      if (current.files.route) {
        endpoint.route = current.files.route;
      }

      // Parameter names are irrelevant to matching, so `/:id` and `/:name` collide.
      const pattern = endpoint.path
        .replace(/:\w+/g, ":")
        .replace(/\*\w+/g, "*")
        .toLowerCase();
      const owner = owners.get(pattern);

      if (owner) {
        throw new Error(
          `Conflicting routes for ${endpoint.path}: ${owner.dir || "/"} and ${current.dir}`,
        );
      }

      owners.set(pattern, current);
      result.push(endpoint);
    }

    for (const child of current.children) {
      visit(child, here, inherited, nested);
    }
  };

  visit(root, [], [], []);

  return result.sort(compare);
}

/** Generate the React Router route tree with lazy page and layout imports (RSC graph). */
export function rscModule(root: RouteNode): string {
  /** Write one lazy import, or `undefined` when the file does not exist. */
  const lazy = (file: string | undefined) =>
    file ? `() => import(${JSON.stringify(file)})` : "undefined";

  /** Write one node and its children. */
  const emit = (current: RouteNode): string =>
    `{ id: ${JSON.stringify(current.id)}, pageId: ${JSON.stringify(current.pageId)}, path: ${JSON.stringify(current.segment)}, ` +
    (current.segment === "*"
      ? `splat: ${JSON.stringify(current.expressSegment.slice(1))}, `
      : "") +
    `page: ${lazy(current.files.page)}, layout: ${lazy(current.files.layout)}, ` +
    `loading: ${lazy(current.files.loading)}, error: ${lazy(current.files.error)}, ` +
    `children: [${current.children.map(emit).join(", ")}] }`;

  return `export const tree = ${emit(root)};\n`;
}

/** Generate the Express router module with lazy native imports (Node graph). */
export function routerModule(root: RouteNode, runtime: string): string {
  const list = endpoints(root);
  const files = new Set<string>();

  for (const endpoint of list) {
    for (const guard of endpoint.guards) {
      if (guard.middleware) {
        files.add(guard.middleware);
      }
    }

    if (endpoint.route) {
      files.add(endpoint.route);
    }
  }

  const modules = [...files]
    .map(
      (file) =>
        `  ${JSON.stringify(file)}: () => import(${JSON.stringify(file)}),`,
    )
    .join("\n");

  return `import { createRouter } from ${JSON.stringify(runtime)};

export default createRouter({
  endpoints: ${JSON.stringify(list, null, 2)},
  modules: {
${modules}
  },
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
}
