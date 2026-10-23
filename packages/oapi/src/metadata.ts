import { ConstantJson } from "@opentyped/oapi-ast/json";
import { sourceOf } from "@opentyped/oapi-ast/diagnostic";
import type ts from "typescript";
import type { Parser, ParserContext } from "@opentyped/oapi-compiler/parser";
import type { RouteRecord } from "./types.js";

const strings = new Set([
  "operationId",
  "summary",
  "description",
  "requestContentType",
]);
const structured = new Set([
  "tags",
  "externalDocs",
  "security",
  "servers",
  "deprecated",
]);

/** Check that metadata is an object rather than null or an array. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read static handler annotations and separate oapi fields from extra OpenAPI
 * fields.
 */
export function metadata(
  node: ts.Expression,
  checker: ts.TypeChecker,
): {
  annotations: Map<string, string>;
  extras: Record<string, unknown>;
} {
  const value = new ConstantJson(checker).read(node);

  if (!record(value)) {
    return sourceOf(node).fail(
      "Handler.openapi requires a static object or const object reference.",
    );
  }

  const annotations = new Map<string, string>();

  for (const [key, item] of Object.entries(value)) {
    if (strings.has(key)) {
      if (typeof item !== "string") {
        return sourceOf(node).fail(`${key} must be a constant string.`);
      }

      annotations.set(key, item);
    } else if (structured.has(key)) {
      annotations.set(key === "tags" ? "tagsJSON" : key, JSON.stringify(item));
    }
  }

  const extras = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !strings.has(key) && !structured.has(key),
    ),
  );

  return { annotations, extras };
}

/** Apply explicit annotations without discarding generated nested schema fields. */
function merge(target: object, incoming: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error(`Unsafe OpenAPI metadata key ${key}.`);
    }

    const current: unknown = Reflect.get(target, key);

    if (record(value) && record(current)) {
      merge(current, value);
    } else {
      Reflect.set(target, key, structuredClone(value));
    }
  }
}

/** Runs after oapi's emitter so descriptions can extend inferred response schemas. */
export class OperationMetadata implements Parser {
  readonly name = "express-rsc/metadata";

  readonly stage = "document";

  /** Remember the route annotations to apply after OpenAPI generation. */
  constructor(private readonly records: readonly RouteRecord[]) {}

  /** Add each handler's explicit annotations to its generated operation. */
  parse(context: ParserContext): void {
    for (const item of this.records) {
      const method = item.method.toLowerCase() as Lowercase<
        RouteRecord["method"]
      >;
      const operation = context.document.paths[item.path]?.[method];

      if (!operation) {
        return sourceOf(item.node).fail(
          "OpenAPI metadata requires oapi's DocumentEmitter before OperationMetadata.",
        );
      }

      merge(operation, item.extras);
    }
  }
}
