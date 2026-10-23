import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";

const workspace = resolve(import.meta.dirname, "..");

test("Vite enforces server-only boundaries in actual browser builds", () => {
  const cache = join(workspace, "node_modules/.cache");

  mkdirSync(cache, { recursive: true });

  const directory = mkdtempSync(join(cache, "express-rsc-boundary-"));
  /** Write a source file for the isolated build fixture. */
  const put = (file: string, source: string) => {
    const target = join(directory, file);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  };

  /** Build the fixture with the real Vite command. */
  const build = () =>
    execFileSync(
      process.execPath,
      [join(workspace, "node_modules/vite/bin/vite.js"), "build"],
      { cwd: directory, encoding: "utf8", stdio: "pipe" },
    );

  try {
    put("package.json", JSON.stringify({ type: "module" }));
    put(
      "vite.config.ts",
      `import {defineConfig} from "vite"; import {expressRsc} from "@opentyped/vite-express-rsc"; export default defineConfig({build:{rollupOptions:{input:"./index.ts"}}, plugins:[expressRsc({directory:"./app"})]});`,
    );
    put(
      "index.ts",
      `import express from "express"; import appRouter from "express/rsc/bundle"; const app=express(); app.use(appRouter); export const listener=app.listen(0);`,
    );
    put(
      "db.ts",
      `import "server-only"; export const secret = "private-database-token-marker";`,
    );
    put(
      "app/Counter.tsx",
      `"use client"; import {useState} from "react"; export default function Counter(){const [value,setValue]=useState(0); return <button onClick={()=>setValue(value+1)}>{value}</button>}`,
    );
    put(
      "app/page.tsx",
      `import {secret} from "../db"; import Counter from "./Counter"; export default function Page(){return <html><head/><body><p>{secret.length}</p><Counter/></body></html>}`,
    );
    assert.doesNotThrow(build);

    for (const file of readdirSync(join(directory, "dist/client/assets"))) {
      assert.ok(
        !readFileSync(
          join(directory, "dist/client/assets", file),
          "utf8",
        ).includes("private-database-token-marker"),
      );
    }

    put(
      "app/Counter.tsx",
      `"use client"; import {secret} from "../db"; export default function Counter(){return <button>{secret}</button>}`,
    );
    assert.throws(build, (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stderr" in error);
      assert.match(
        String(error.stderr),
        /db.ts is outside app and cannot be imported by browser code/,
      );

      return true;
    });

    // Project files outside the route directory never reach the browser, without any marker.
    put("server/token.ts", `export const token = "server-directory-marker";`);
    put(
      "app/Counter.tsx",
      `"use client"; import {token} from "../server/token"; export default function Counter(){return <button>{token}</button>}`,
    );
    assert.throws(build, (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stderr" in error);
      assert.match(String(error.stderr), /server\/token.ts is outside app/);

      return true;
    });

    // A bundle name that the configuration does not declare fails the build.
    put(
      "index.ts",
      `import express from "express"; import admin from "express/rsc/bundle/admin"; express().use(admin);`,
    );
    assert.throws(build, (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stderr" in error);
      assert.match(String(error.stderr), /Unknown bundle "admin"/);

      return true;
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
