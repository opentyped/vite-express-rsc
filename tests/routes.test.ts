import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definitions } from "../packages/vite-express-rsc/dist/routes.js";

test("one convention tree is deterministic and rejects HTTP method conflicts", () => {
  const directory = mkdtempSync(join(tmpdir(), "express-rsc-"));
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
    assert.ok(source.includes('path:":id"'));
    assert.ok(!source.includes('path:"(group)"'));
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
    writeFileSync(file, "export function mount(){}; export const GET=()=>{}");
    assert.throws(() => definitions(directory), /Replace mount/);
    writeFileSync(file, "export * from './elsewhere'");
    assert.throws(() => definitions(directory), /Wildcard exports/);
    writeFileSync(file, "export const action=()=>{}");
    assert.throws(() => definitions(directory), /Actions are disabled/);
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
