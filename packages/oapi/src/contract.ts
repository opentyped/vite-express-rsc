import ts from "typescript";
import { sourceOf } from "@opentyped/oapi-ast/diagnostic";
import type { Project } from "@opentyped/oapi-ast/project";
import type { CompiledRoute, RouteRecord } from "./types.js";

/**
 * Give oapi checked request and response types without changing application source
 * files.
 */
export function contracts(
  project: Project,
  records: readonly RouteRecord[],
): {
  project: Project;
  records: CompiledRoute[];
} {
  const additions = new Map<string, string>();
  const names = new Map<RouteRecord, string>();

  for (const [index, record] of records.entries()) {
    const declaration = record.symbol.valueDeclaration;

    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) {
      return sourceOf(record.node).fail(
        "Documented methods require a typed local const handler.",
      );
    }

    let type = declaration.type;

    if (
      !type &&
      declaration.initializer &&
      ts.isSatisfiesExpression(declaration.initializer)
    ) {
      type = declaration.initializer.type;
    }

    while (type && ts.isParenthesizedTypeNode(type)) {
      type = type.type;
    }

    const symbol =
      type && ts.isTypeReferenceNode(type)
        ? project.checker.getSymbolAtLocation(type.typeName)
        : undefined;
    const target =
      symbol && symbol.flags & ts.SymbolFlags.Alias
        ? project.checker.getAliasedSymbol(symbol)
        : symbol;
    const native = target?.declarations?.some(
      (node) =>
        ts.isInterfaceDeclaration(node) &&
        node.name.text === "RequestHandler" &&
        /[/\\]@types[/\\]express(?:-serve-static-core)?[/\\]/.test(
          node.getSourceFile().fileName,
        ),
    );

    if (
      !native ||
      !type ||
      !ts.isTypeReferenceNode(type) ||
      !type.typeArguments?.[1]
    ) {
      return sourceOf(record.node).fail(
        "Documented methods require Express RequestHandler<Params, ResponseBody, RequestBody?, Query?>. Express's first generic is params, not an HTTP input contract.",
      );
    }

    const args = type.typeArguments;
    const name = `__express_rsc_oapi_${index}`;

    if (
      record.source.statements.some(
        (node) => ts.isTypeAliasDeclaration(node) && node.name.text === name,
      )
    ) {
      return sourceOf(record.node).fail(
        `Reserved generated type name ${name}.`,
      );
    }

    const params = project.checker.getTypeAtLocation(args[0]);
    const fields =
      params.getProperties().length || params.getStringIndexType()
        ? [`params: ${args[0].getText()}`]
        : [];

    if (args[2]) {
      fields.push(`body: ${args[2].getText()}`);
    }

    if (args[3]) {
      fields.push(`query: ${args[3].getText()}`);
    }

    fields.push(`responses: { 200: { body: ${args[1].getText()} } }`);

    const text = `\ntype ${name} = { ${fields.join("; ")} };\n`;

    additions.set(
      record.source.fileName,
      (additions.get(record.source.fileName) ?? "") + text,
    );
    names.set(record, name);
  }

  const previous = project.program;
  const options = previous.getCompilerOptions();
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);

  host.readFile = (file) => {
    const source = previous.getSourceFile(file);

    if (source) {
      return source.text + (additions.get(file) ?? "");
    }

    return read(file);
  };

  const program = ts.createProgram({
    rootNames: previous.getRootFileNames(),
    options,
    host,
    projectReferences: previous.getProjectReferences(),
  });
  const compiled = records.map((record): CompiledRoute => {
    const source = program.getSourceFile(record.source.fileName);
    const input = source?.statements
      .filter(ts.isTypeAliasDeclaration)
      .find((node) => node.name.text === names.get(record));

    if (!input) {
      return sourceOf(record.node).fail(
        "Cannot construct checked filesystem contract.",
      );
    }

    return { ...record, input };
  });

  return {
    project: { ...project, program, checker: program.getTypeChecker() },
    records: compiled,
  };
}
