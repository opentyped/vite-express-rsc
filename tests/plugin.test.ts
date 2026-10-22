import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { fullstack } from "../packages/vite-express-rsc/dist/plugin.js";

test("unsupported output layouts fail during configuration rather than emitting broken builds", async () => {
  const root = mkdtempSync(join(tmpdir(), "express-rsc-config-"));

  mkdirSync(join(root, "app"));
  writeFileSync(
    join(root, "app/page.tsx"),
    "export default function Page(){return null}",
  );
  writeFileSync(join(root, "index.ts"), "export {}");

  try {
    for (const overrides of [
      { base: "/prefix/" },
      { build: { outDir: "output" } },
    ]) {
      await assert.rejects(
        resolveConfig(
          {
            root,
            configFile: false,
            logLevel: "silent",
            plugins: [fullstack({ entry: "./index.ts", directory: "./app" })],
            ...overrides,
          },
          "build",
        ),
        /requires base '\/' and build.outDir 'dist'/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
