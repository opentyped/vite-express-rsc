import path from "node:path";
import ts from "typescript";
import { ParserContext } from "@opentyped/oapi-compiler/parser";
import type { Parser, ModelIdentity } from "@opentyped/oapi-compiler/parser";
import type { CompiledRoute, HttpMethod, RouteRecord } from "./types.js";
import { sourceOf } from "@opentyped/oapi-ast/diagnostic";
import { contracts } from "./contract.js";
import { metadata, OperationMetadata } from "./metadata.js";

export interface FilesystemOptions {
  /** Relative to the generation root, which defaults to the tsconfig directory. */
  directory: string;
  /** Static Express mount prefix. Defaults to /. */
  prefix?: string;
}

const methods = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const contributions = new WeakMap<ParserContext, readonly CompiledRoute[]>();

function routePath(
  file: string,
  directory: string,
  prefix: string,
  node: ts.Node,
): string {
  const segments = path
    .relative(directory, path.dirname(file))
    .split(path.sep)
    .filter(Boolean);
  const parts = segments.flatMap((segment) => {
    if (/^\([\w-]+\)$/.test(segment)) {
      return [];
    }

    if (/^\[[A-Za-z_]\w*\]$/.test(segment)) {
      return [`{${segment.slice(1, -1)}}`];
    }

    if (/^[\w-]+$/.test(segment)) {
      return [segment];
    }

    return sourceOf(node).fail(
      `Unsupported OpenAPI route segment ${segment}. Catch-all routes cannot be represented as ordinary OpenAPI path parameters.`,
    );
  });

  return `${prefix}/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

function resolveSymbol(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);

  return symbol && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

/** Filesystem paths supply registration; Express's own generics supply the contract. */
class FilesystemRoutes {
  private readonly options: Required<FilesystemOptions>;

  constructor(options: FilesystemOptions) {
    if (!options?.directory || typeof options.directory !== "string") {
      throw new Error("FilesystemParser requires a route directory.");
    }

    const prefix = options.prefix ?? "";

    if (
      typeof prefix !== "string" ||
      (prefix && !/^\/(?:[\w-]+\/)*[\w-]*$/.test(prefix))
    ) {
      throw new Error(
        "FilesystemParser prefix requires a static absolute URL path.",
      );
    }

    this.options = { ...options, prefix: prefix.replace(/\/$/, "") };
  }

  prepare(context: ParserContext): ParserContext {
    if (context.declarations.length) {
      throw new Error(
        "Place FilesystemParser before other discovery parsers; use filesystemParsers(options, defaultParsers()).",
      );
    }

    const project = context.project;
    const root = path.resolve(
      context.options.root ?? path.dirname(project.configPath),
    );
    const directory = path.resolve(root, this.options.directory);
    const checker = project.checker;
    const records: RouteRecord[] = [];
    const seen = new Set();
    const directories = new Set();
    const sources = project.program
      .getSourceFiles()
      .filter(
        (source) =>
          !source.isDeclarationFile &&
          !project.program.isSourceFileFromExternalLibrary(source),
      )
      .filter((source) => {
        const relative = path.relative(directory, source.fileName);

        return (
          relative &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative) &&
          ["route.ts", "routes.tsx"].includes(path.basename(source.fileName))
        );
      })
      .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));

    for (const source of sources) {
      const folder = path.dirname(source.fileName);

      if (directories.has(folder)) {
        sourceOf(source).fail(
          "A directory cannot contain both route.ts and routes.tsx.",
        );
      }

      directories.add(folder);

      const symbol = checker.getSymbolAtLocation(source);
      const exports = symbol && checker.getExportsOfModule(symbol);

      for (const exported of exports ?? []) {
        const method = exported.name;

        if (!methods.has(method)) {
          continue;
        }

        const handler =
          exported.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(exported)
            : exported;
        const declarations: ts.BinaryExpression[] = [];
        const visit = (node: ts.Node): void => {
          if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) &&
            node.left.name.text === "openapi" &&
            resolveSymbol(checker, node.left.expression) === handler
          ) {
            if (
              !ts.isExpressionStatement(node.parent) ||
              node.parent.parent !== source
            ) {
              sourceOf(node).fail(
                "Assign handler.openapi once at module scope, without conditionals.",
              );
            }

            declarations.push(node);
          }

          ts.forEachChild(node, visit);
        };

        visit(source);

        if (!declarations.length) {
          continue;
        }

        if (declarations.length !== 1) {
          sourceOf(declarations[1]).fail(
            "Duplicate handler.openapi assignment.",
          );
        }

        const node = declarations[0];

        if (handler.valueDeclaration?.getSourceFile() !== source) {
          sourceOf(node).fail(
            "Documented handlers must be declared in their route module.",
          );
        }

        const url = routePath(
          source.fileName,
          directory,
          this.options.prefix,
          node,
        );
        const key = `${method} ${url.replace(/\{[^}]+\}/g, "{}").toLowerCase()}`;

        if (seen.has(key)) {
          sourceOf(node).fail(
            `Conflicting filesystem operation ${method} ${url}.`,
          );
        }

        seen.add(key);

        const { annotations, extras } = metadata(node.right, checker);
        const name =
          annotations.get("operationId") ??
          method.toLowerCase() +
            (
              url.replace(/\{([^}]+)\}/g, "by/$1").match(/[A-Za-z0-9_]+/g) ?? [
                "root",
              ]
            )
              .map((word) => word[0].toUpperCase() + word.slice(1))
              .join("");

        annotations.set("operationId", name);
        annotations.set("route", `${method} ${url}`);
        records.push({
          symbol: handler,
          source,
          node,
          path: url,
          method: method as HttpMethod,
          name,
          annotations,
          extras,
        });
      }
    }

    if (!records.length) {
      return context;
    }

    const originalNodes = new Map<string, Map<string, ts.Node>>();

    for (const source of project.program.getSourceFiles()) {
      const nodes = new Map<string, ts.Node>();
      const visit = (node: ts.Node): void => {
        if (
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isTypeLiteralNode(node) ||
          ts.isMappedTypeNode(node)
        ) {
          nodes.set(`${node.pos}:${node.kind}`, node);
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
      originalNodes.set(source.fileName, nodes);
    }

    const compiled = contracts(project, records);
    // oapi 0.1 derives names from filenames; brackets/groups are illegal component keys.
    const originalName = context.identities.name.bind(context.identities);
    const names = new Map<string, string>();
    const identities: ModelIdentity = {
      ...(context.identities.namespace
        ? { namespace: context.identities.namespace.bind(context.identities) }
        : {}),
      ...(context.identities.canonical
        ? { canonical: context.identities.canonical.bind(context.identities) }
        : {}),
      ...(context.identities.generatedName
        ? {
            generatedName: context.identities.generatedName.bind(
              context.identities,
            ),
          }
        : {}),
      name: (node) => {
        const prior = originalNodes
          .get(node.getSourceFile().fileName)
          ?.get(`${node.pos}:${node.kind}`);
        const original = originalName(prior ?? node);

        if (original === undefined) {
          return undefined;
        }

        const encoded = original.replace(
          /[^a-zA-Z0-9._-]/gu,
          (character) => `_u${character.codePointAt(0)?.toString(16)}_`,
        );

        if (names.has(encoded) && names.get(encoded) !== original) {
          sourceOf(node).fail(
            `Conflicting encoded OpenAPI component name ${encoded}.`,
          );
        }

        names.set(encoded, original);

        return encoded;
      },
    };
    const overlay = new ParserContext(
      compiled.project,
      context.options,
      identities,
      context.hasDocuments,
    );

    Object.assign(overlay.document, structuredClone(context.document));
    Object.assign(overlay.schemas, structuredClone(context.schemas));
    overlay.warnings.push(...context.warnings);
    overlay.transforms.push(...context.transforms);

    for (const record of compiled.records) {
      overlay.declarations.push({
        node: record.input,
        name: record.name,
        source: sourceOf(record.node),
        annotations: record.annotations,
        emitSchema: false,
        emitOperation: true,
        emitResponse: false,
      });
    }

    contributions.set(overlay, compiled.records);

    return overlay;
  }
}

/** Keep oapi's cached project intact while each parser receives the checked overlay. */
export function filesystemParsers(
  options: FilesystemOptions,
  defaults: readonly Parser[],
): Parser[] {
  if (!Array.isArray(defaults)) {
    throw new Error("Supply oapi's defaultParsers() array.");
  }

  const routes = new FilesystemRoutes(options);
  const overlays = new WeakMap<ParserContext, ParserContext>();
  const publish = (outer: ParserContext, overlay: ParserContext): void => {
    if (outer === overlay) {
      return;
    }

    outer.declarations = overlay.declarations;
    outer.compilation = overlay.compilation;
    outer.warnings.splice(0, outer.warnings.length, ...overlay.warnings);
    outer.transforms.splice(0, outer.transforms.length, ...overlay.transforms);

    for (const key of Reflect.ownKeys(outer.document)) {
      if (!Reflect.has(overlay.document, key)) {
        Reflect.deleteProperty(outer.document, key);
      }
    }

    Object.assign(outer.document, overlay.document);
    Object.assign(outer.schemas, overlay.schemas);
  };

  return [
    {
      name: "express-rsc/endpoints",
      stage: "discover",
      parse(context): void {
        const overlay = routes.prepare(context);

        overlays.set(context, overlay);
        publish(context, overlay);
      },
    },
    ...defaults.map(
      (parser): Parser => ({
        name: parser.name,
        stage: parser.stage,
        parse(context): void {
          const overlay = overlays.get(context) ?? context;

          parser.parse(overlay);
          publish(context, overlay);
        },
      }),
    ),
    {
      name: "express-rsc/metadata",
      stage: "document",
      parse(context): void {
        const overlay = overlays.get(context) ?? context;

        new OperationMetadata(contributions.get(overlay) ?? []).parse(overlay);
        publish(context, overlay);
      },
    },
  ];
}
