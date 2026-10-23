import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

test("published types declare express/rsc modules without generated files", () => {
  const cache = resolve(import.meta.dirname, "../node_modules/.cache");

  mkdirSync(cache, { recursive: true });

  const root = mkdtempSync(join(cache, "module-types-"));
  const consumer = join(root, "index.ts");

  try {
    writeFileSync(
      consumer,
      `import app from "express/rsc/bundle";
       import admin from "express/rsc/bundle/admin";
       import { getRequestContext } from "express/rsc/context";
       import type { PageProps, PageLoader } from "express/rsc";
       const handlers: import("express").RequestHandler[] = [app, admin];
       const signal: AbortSignal = getRequestContext().signal;
       const loader: PageLoader<{ id: string }> = () => ({ id: "1" });
       const props: PageProps<typeof loader> = { loaderData: { id: "1" }, params: {} };
       const invalid: number = app;`,
    );

    const program = ts.createProgram([consumer], {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      esModuleInterop: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      types: ["node", "@opentyped/vite-express-rsc/types"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    // Only the deliberate `invalid` assignment fails.
    assert.deepEqual(
      diagnostics.map((diagnostic) => [
        diagnostic.code,
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ]),
      [
        [
          2322,
          "Type 'RequestHandler<ParamsDictionary, any, any, ParsedQs, Record<string, any>>' is not assignable to type 'number'.",
        ],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
