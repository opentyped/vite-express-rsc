import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { generate, GenerationCompiler } from "@opentyped/oapi-compiler";
import { generateDefinitions } from "@opentyped/oapi-tsgen";
import { SchemaDiscovery } from "@opentyped/oapi-compiler/parser/schema/discovery";
import { JSDocEndpointParser } from "@opentyped/oapi-compiler/parser/endpoint/parser";
import { DocumentParser } from "@opentyped/oapi-compiler/parser/document/parser";
import {
  SchemaSafety,
  SchemaCompiler,
} from "@opentyped/oapi-compiler/parser/schema/steps";
import { DocumentEmitter } from "@opentyped/oapi-compiler/parser/document/emitter";
import type { FilesystemOptions } from "../packages/oapi/dist/index.js";
import type { Generation } from "@opentyped/oapi-compiler";
import { filesystemParsers } from "../packages/oapi/dist/index.js";

const defaults = () => [
  new SchemaDiscovery(),
  new JSDocEndpointParser(),
  new DocumentParser(),
  new SchemaSafety(),
  new SchemaCompiler(),
  new DocumentEmitter(),
];
const header = `import type { RequestHandler } from "express";
import "@opentyped/vite-express-rsc/types";
`;

interface Fixture {
  root: string;
  put(name: string, text: string): Promise<void>;
  build(
    extra?: Partial<FilesystemOptions>,
    compiler?: GenerationCompiler,
  ): Generation;
}

async function fixture(run: (fixture: Fixture) => Promise<void>) {
  const cache = path.resolve("node_modules/.cache");

  await mkdir(cache, { recursive: true });

  const root = await mkdtemp(path.join(cache, "oapi-"));
  const put = async (name: string, text: string) => {
    const file = path.join(root, name);

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };

  await put(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        jsx: "react-jsx",
        types: ["node"],
      },
      include: ["app/**/*"],
    }),
  );

  const build = (
    extra: Partial<FilesystemOptions> = {},
    compiler?: GenerationCompiler,
  ) =>
    (compiler ? compiler.generate.bind(compiler) : generate)(
      {
        root,
        tsconfig: "tsconfig.json",
        info: { title: "Filesystem", version: "1.0.0" },
        parsers: filesystemParsers({ directory: "app", ...extra }, defaults()),
      },
      defaults,
    );

  try {
    await run({ root, put, build });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("oapi compiles native Express filesystem handlers into real OpenAPI contracts", async () => {
  await fixture(async ({ put, build }) => {
    await put(
      "app/(internal)/orders/[id]/routes.tsx",
      header +
        `
      interface Params { id: string }
      interface Order { id: string; total: number }
      interface Body { note: string }
      interface Query { expand?: boolean }
      export const middlewares: RequestHandler[] = [() => { throw new Error("Parser must not execute middleware"); }];
      export const GET: RequestHandler<Params, Order, Body, Query> = (_req, _res) => { throw new Error("Parser must not execute handlers"); };
      const documentation = { operationId: "getOrder", description: "An order", tags: ["Orders"], security: [{ session: [] }], responses: { "200": { description: "Order found" } }, "x-owned-by": "sales" };
      GET.openapi = documentation;
      GET.middlewares = middlewares;
      throw new Error("Parser must not evaluate route modules");
    `,
    );
    await put(
      "app/health/route.ts",
      header +
        `export const GET: RequestHandler<{}, { ok: boolean }> = (_req, res) => { res.json({ ok: true }); }; GET.openapi = { summary: "Health" };`,
    );
    await put(
      "app/ignored/page.tsx",
      `export default function Page() { return <p>Ignored</p>; }`,
    );

    const result = build({ prefix: "/api" });
    const operation = result.document.paths["/api/orders/{id}"].get;

    assert.ok(operation);
    assert.ok(operation.responses);

    const response = operation.responses["200"];

    assert.ok(response && !("$ref" in response));
    assert.ok(response.content);

    const json = response.content["application/json"];

    assert.ok(json && !("$ref" in json));
    assert.ok(operation.parameters);

    const body = operation.requestBody;

    assert.ok(body && !("$ref" in body));

    const requestJSON = body.content["application/json"];

    assert.ok(requestJSON && !("$ref" in requestJSON));
    assert.equal(operation.operationId, "getOrder");
    assert.equal(operation.description, "An order");
    assert.deepEqual(operation.tags, ["Orders"]);
    assert.deepEqual(operation.security, [{ session: [] }]);
    assert.equal(operation["x-owned-by"], "sales");
    assert.equal(response.description, "Order found");
    assert.ok(json.schema);
    assert.deepEqual(
      operation.parameters.map((parameter) => {
        assert.ok(!("$ref" in parameter));

        return [parameter.in, parameter.name];
      }),
      [
        ["path", "id"],
        ["query", "expand"],
      ],
    );
    assert.ok(requestJSON.schema);
    assert.equal(
      result.document.paths["/api/health"].get?.operationId,
      "getApiHealth",
    );
    assert.equal(Object.keys(result.document.paths).length, 2);
    assert.ok(Object.keys(result.document.components.schemas).length > 0);
    assert.deepEqual(build({ prefix: "/api" }).document, result.document);

    const declarations = generateDefinitions(result.document);

    assert.match(declarations, /getOrder/);
    assert.match(declarations, /total/);

    const compiler = new GenerationCompiler(defaults);

    assert.deepEqual(
      build({ prefix: "/api" }, compiler).document,
      result.document,
    );
    assert.deepEqual(
      build({ prefix: "/api" }, compiler).document,
      result.document,
    );
  });
});

test("oapi diagnostics reject ambiguous and unrepresentable filesystem contracts", async () => {
  for (const scenario of [
    {
      name: "duplicate",
      files: {
        "app/(a)/same/route.ts": "GET.openapi = {};",
        "app/(b)/same/route.ts": "GET.openapi = {};",
      },
      error: /Conflicting filesystem operation/,
    },
    {
      name: "catchall",
      files: { "app/[...slug]/route.ts": "GET.openapi = {};" },
      error: /Catch-all routes/,
    },
    {
      name: "conditional",
      files: { "app/route.ts": "if (Date.now()) GET.openapi = {};" },
      error: /module scope/,
    },
    {
      name: "duplicate metadata",
      files: { "app/route.ts": "GET.openapi = {}; GET.openapi = {};" },
      error: /Duplicate handler.openapi/,
    },
    {
      name: "dynamic metadata",
      files: {
        "app/route.ts": "GET.openapi = { description: String(Date.now()) };",
      },
      error: /constant|static|supported/i,
    },
  ]) {
    await fixture(async ({ put, build }) => {
      for (const [file, annotation] of Object.entries(scenario.files)) {
        await put(
          file,
          header +
            `export const GET: RequestHandler<{}, { ok: boolean }> = (_req, res) => { res.json({ ok: true }); }; ${annotation}`,
        );
      }

      assert.throws(build, scenario.error, scenario.name);
    });
  }
});
