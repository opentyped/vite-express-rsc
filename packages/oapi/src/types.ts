import type ts from "typescript";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface RouteRecord {
  symbol: ts.Symbol;
  source: ts.SourceFile;
  node: ts.BinaryExpression;
  path: string;
  method: HttpMethod;
  name: string;
  annotations: Map<string, string>;
  extras: Record<string, unknown>;
}

export interface CompiledRoute extends RouteRecord {
  input: ts.TypeAliasDeclaration;
}
