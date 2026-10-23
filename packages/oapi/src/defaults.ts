import type { Parser } from "@opentyped/oapi-compiler/parser";
import { SchemaDiscovery } from "@opentyped/oapi-compiler/parser/schema/discovery";
import { JSDocEndpointParser } from "@opentyped/oapi-compiler/parser/endpoint/parser";
import { DocumentParser } from "@opentyped/oapi-compiler/parser/document/parser";
import {
  SchemaSafety,
  SchemaCompiler,
} from "@opentyped/oapi-compiler/parser/schema/steps";
import { DocumentEmitter } from "@opentyped/oapi-compiler/parser/document/emitter";

/** OAPI's standard pipeline: discover schemas and endpoints, then emit the document. */
export function defaultParsers(): Parser[] {
  return [
    new SchemaDiscovery(),
    new JSDocEndpointParser(),
    new DocumentParser(),
    new SchemaSafety(),
    new SchemaCompiler(),
    new DocumentEmitter(),
  ];
}
