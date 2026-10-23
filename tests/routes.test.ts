import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scan,
  endpoints,
  rscModule,
  routerModule,
} from "../packages/vite-express-rsc/dist/routes.js";

/** Validate a route directory and return both generated module sources. */
const definitions = (directory: string) => {
  const tree = scan(directory);

  return rscModule(tree) + routerModule(tree, "runtime");
};

test("one convention tree is deterministic and rejects HTTP method conflicts", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-"));
  /** Write a route fixture and create any missing parent folders. */
  const put = (
    path: string,
    source = "export default function Page(){return null}",
  ) => {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), source);
  };

  try {
    put("layout.tsx");
    put("page.tsx");
    put("components/Counter.tsx");
    put("(group)/users/[id]/page.tsx");

    const source = definitions(directory);

    assert.equal(source, definitions(directory));
    assert.ok(!source.includes("Counter"));
    assert.ok(source.includes('path: ":id"'));
    assert.ok(!source.includes('path: "(group)"'));
    put("(group)/users/[id]/route.ts", "export const POST=()=>{}");
    assert.doesNotThrow(() => definitions(directory));
    put("(group)/users/[id]/route.ts", "export { GET } from './handler'");
    assert.throws(() => definitions(directory), /Conflicting routes \(GET\)/);
    rmSync(join(directory, "(group)/users/[id]/route.ts"));
    put("users/[name]/page.tsx");
    assert.throws(() => definitions(directory), /Conflicting routes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("invalid conventions give build-time diagnostics", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-"));
  const file = join(directory, "route.ts");

  try {
    writeFileSync(join(directory, "routes.tsx"), "export const POST=()=>{}");
    assert.match(definitions(directory), /routes.tsx/);
    writeFileSync(file, "export const GET=()=>{}");
    assert.throws(() => definitions(directory), /one raw route module/);
    rmSync(join(directory, "routes.tsx"));
    writeFileSync(file, "export * from './elsewhere'");
    assert.throws(() => definitions(directory), /Wildcard exports/);
    writeFileSync(file, "export const action=()=>{}");
    assert.throws(() => definitions(directory), /Actions are not supported/);
    rmSync(file);
    writeFileSync(
      join(directory, "page.tsx"),
      '"use client"; export const metadata={title:"Invalid"}; export default function Page(){return null}',
    );
    assert.throws(() => definitions(directory), /use-client module/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Express convention modules cannot become client references", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-client-"));

  try {
    for (const filename of ["route.ts", "routes.tsx", "middleware.ts"]) {
      const file = join(directory, filename);

      writeFileSync(
        file,
        '"use client"; export const GET=()=>{}; export default function middleware(){}',
      );
      assert.throws(
        () => definitions(directory),
        /Express route and middleware modules cannot use/,
      );
      rmSync(file);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("nested dynamic segments must have unique parameter names", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-params-"));

  try {
    const endpoint = join(directory, "[id]", "posts", "[id]");

    mkdirSync(endpoint, { recursive: true });
    writeFileSync(
      join(endpoint, "page.tsx"),
      "export default function Page(){return null}",
    );
    assert.throws(
      () => definitions(directory),
      /Duplicate dynamic parameter 'id'/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Express registrations are ordered by specificity with inherited guards", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-order-"));
  /** Write a route fixture and create any missing parent folders. */
  const put = (path: string, source: string) => {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), source);
  };

  const page = "export default function Page(){return null}";

  try {
    put("middleware.ts", "export default (q,s,n)=>n()");
    put(
      "docs/layout.tsx",
      "export const middlewares=[]; export default function L(){return null}",
    );
    put("docs/[...slug]/page.tsx", page);
    put("docs/intro/page.tsx", page);
    put(
      "users/[id]/route.ts",
      "export const GET=()=>{}; export const HEAD=()=>{}",
    );
    put("users/new/page.tsx", page);
    put("(marketing)/about/page.tsx", page);

    const list = endpoints(scan(directory));

    assert.deepEqual(
      list.map((endpoint) => endpoint.path),
      ["/about", "/docs/intro", "/docs/*slug", "/users/new", "/users/:id"],
    );

    const splat = list.find((endpoint) => endpoint.path === "/docs/*slug")!;

    assert.deepEqual(
      splat.guards.map((guard) => [guard.id, !!guard.middleware, guard.layout]),
      [
        ["layout:", true, undefined],
        ["layout:docs", false, "layout:docs"],
      ],
    );
    assert.equal(splat.page, "page:docs/[...slug]");
    assert.deepEqual(
      list.find((endpoint) => endpoint.path === "/users/:id")!.methods,
      ["GET", "HEAD"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
