import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parse } from "@babel/parser";

export const methods = [
  "HEAD",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const filenames = new Set([
  "page.tsx",
  "layout.tsx",
  "middleware.ts",
  "route.ts",
  "routes.tsx",
  "loading.tsx",
  "error.tsx",
]);

export function discover(directory: string): string[] {
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

export function segment(name: string): string {
  if (/^\([\w-]+\)$/.test(name)) {
    return "";
  }

  if (/^\[\.\.\.[A-Za-z_]\w*\]$/.test(name)) {
    return "*";
  }

  if (/^\[[A-Za-z_]\w*\]$/.test(name)) {
    return ":" + name.slice(1, -1);
  }

  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Unsupported route segment: ${name}`);
  }

  return name;
}

function exportsOf(file: string): Set<string> {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  });
  const client = ast.program.directives.some(
    (directive) => directive.value.value === "use client",
  );

  if (
    client &&
    ["route.ts", "routes.tsx", "middleware.ts"].includes(basename(file))
  ) {
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
        specifier.type !== "ExportSpecifier" ||
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

    if (
      declaration &&
      "id" in declaration &&
      declaration.id?.type === "Identifier"
    ) {
      names.add(declaration.id.name);
    }

    for (const item of declaration?.type === "VariableDeclaration"
      ? declaration.declarations
      : []) {
      if (item.id.type !== "Identifier") {
        throw new Error(`Use named export bindings in ${file}`);
      }

      names.add(item.id.name);
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

  if (names.has("mount")) {
    throw new Error(`Replace mount() with export const middlewares in ${file}`);
  }

  if (names.has("action") || names.has("clientAction")) {
    throw new Error(
      `Actions are disabled; export HTTP methods from route.ts: ${file}`,
    );
  }

  return names;
}

interface RouteDefinition {
  id: string;
  path: string;
  files: Record<string, { file: string; methods: string[] }>;
  children: Map<string, RouteDefinition>;
}

/**
 * Generate source imports during compilation; production never scans route
 * directories.
 */
export function definitions(directory: string): string {
  const root: RouteDefinition = {
    id: "layout:",
    path: "",
    files: {},
    children: new Map(),
  };
  const endpoints = new Map<string, string>();
  const owners = new Map<string, string>();

  for (const file of discover(directory)) {
    const parts = file.split("/");
    const filename = parts.pop()!;

    if (!filenames.has(filename)) {
      continue;
    }

    const raw = filename === "route.ts" || filename === "routes.tsx";
    const names = exportsOf(join(directory, file));

    if (!raw && !names.has("default")) {
      throw new Error(`Expected a default export in ${file}`);
    }

    if (raw && !methods.some((method) => names.has(method))) {
      throw new Error(`Export an HTTP method from ${file}`);
    }

    const parameters = new Set<string>();

    for (const part of parts) {
      if (/^\[[A-Za-z_]\w*\]$/.test(part)) {
        const parameter = part.slice(1, -1);

        if (parameters.has(parameter)) {
          throw new Error(
            `Duplicate dynamic parameter '${parameter}' in ${file}`,
          );
        }

        parameters.add(parameter);
      }
    }

    const paths = parts.map(segment);

    if (paths.includes("*") && paths.at(-1) !== "*") {
      throw new Error(`Catch-all must be the final URL segment: ${file}`);
    }

    const path = paths.filter(Boolean).join("/");
    const exportedMethods =
      filename === "page.tsx"
        ? ["GET", "HEAD"]
        : raw
          ? methods.filter((method) => names.has(method))
          : [];

    if (raw && names.has("GET") && !names.has("HEAD")) {
      exportedMethods.push("HEAD");
    }

    for (const method of exportedMethods) {
      const key =
        method + ":" + path.replace(/:[^/]+/g, ":param").toLowerCase();

      if (endpoints.has(key)) {
        throw new Error(
          `Conflicting routes (${method}): ${endpoints.get(key)} and ${file}`,
        );
      }

      endpoints.set(key, file);
    }

    if (exportedMethods.length) {
      const pattern = path.replace(/:[^/]+/g, ":param").toLowerCase();
      const owner = parts.join("/");

      if (owners.has(pattern) && owners.get(pattern) !== owner) {
        throw new Error(
          `Conflicting routes in separate directory branches: ${owners.get(pattern)} and ${owner}`,
        );
      }

      owners.set(pattern, owner);
    }

    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];

      if (!node.children.has(name)) {
        node.children.set(name, {
          id: "layout:" + parts.slice(0, i + 1).join("/"),
          path: paths[i],
          files: {},
          children: new Map(),
        });
      }

      node = node.children.get(name)!;
    }

    const key = raw ? "route.ts" : filename;

    if (node.files[key]) {
      throw new Error(`Use only one raw route module per directory: ${file}`);
    }

    node.files[key] = {
      file: join(directory, file),
      methods: exportedMethods,
    };
  }

  const validate = (node: RouteDefinition): void => {
    if (node.path === "*" && (node.children.size || node.files["layout.tsx"])) {
      throw new Error(
        `Catch-all routes must be leaves without a layout: ${node.id}`,
      );
    }

    for (const child of node.children.values()) {
      validate(child);
    }
  };

  validate(root);

  const emit = (node: RouteDefinition): string =>
    `{id:${JSON.stringify(node.id)},path:${JSON.stringify(node.path)},files:{${Object.entries(
      node.files,
    )
      .map(
        ([name, { file, methods }]) =>
          `${JSON.stringify(name)}:{load:()=>import(${JSON.stringify(file)}),methods:${JSON.stringify(methods)}}`,
      )
      .join(
        ",",
      )}},children:[${[...node.children.values()].map(emit).join(",")}]}`;

  return `export const definitions=[${emit(root)}];`;
}
