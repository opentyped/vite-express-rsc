import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

test("handler annotations accept OpenAPI 3.2 fields and reject invalid values", () => {
  const cache = resolve("node_modules/.cache");

  mkdirSync(cache, { recursive: true });

  const directory = mkdtempSync(join(cache, "openapi-types-"));
  const file = join(directory, "annotations.ts");

  try {
    writeFileSync(
      file,
      `
      import type { OpenAPIOperation } from "@opentyped/vite-express-rsc";
      const valid: OpenAPIOperation = {
        operationId: "search",
        parameters: [{ name: "filter", in: "querystring", content: { "application/json": { schema: { type: "object" } } } }],
        responses: { "2XX": { summary: "Successful search", description: "Matching results" }, default: { description: "An error" } },
        "x-owner": "search-team",
      };
      const wrongField: OpenAPIOperation = { operationID: "typo" };
      const wrongStatus: OpenAPIOperation = { responses: { banana: { description: "Invalid status" } } };
      const wrongResponse: OpenAPIOperation = { responses: { "200": { descriptin: "typo" } } };
      const wrongValue: OpenAPIOperation = { deprecated: "yes" };
    `,
    );

    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      types: ["node"],
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
    const messages = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n");

    assert.equal(errors.length, 4, messages);
    assert.match(messages, /operationID/);
    assert.match(messages, /banana/);
    assert.match(messages, /descriptin/);
    assert.match(messages, /boolean/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
