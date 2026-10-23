import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { generate } from "@opentyped/oapi-compiler";
import {
  defaultParsers,
  filesystemParsers,
} from "../packages/oapi/dist/index.js";

const example = resolve(import.meta.dirname, "../examples/basic");

/** Find a free local port. */
async function freePort() {
  const socket = createServer().listen(0, "127.0.0.1");

  await once(socket, "listening");

  const { port } = socket.address() as { port: number };

  await new Promise((resolve) => socket.close(resolve));

  return port;
}

test("the committed openapi.json matches the example's routes", () => {
  const { document } = generate(
    {
      root: example,
      tsconfig: "tsconfig.json",
      info: { title: "Todos", version: "1.0.0" },
      parsers: filesystemParsers({ directory: "src/app" }, defaultParsers()),
    },
    defaultParsers,
  );
  const committed = JSON.parse(
    readFileSync(resolve(example, "openapi.json"), "utf8"),
  );

  assert.deepEqual(
    committed,
    JSON.parse(JSON.stringify(document)),
    "run npm run openapi",
  );
  assert.deepEqual(Object.keys(document.paths).sort(), [
    "/api/todos",
    "/api/todos/{id}",
  ]);
  assert.deepEqual(
    Object.values(document.paths)
      .flatMap((item) =>
        ["get", "post", "delete"].flatMap((method) => {
          const operation = (item as Record<string, { operationId?: string }>)[
            method
          ];

          return operation?.operationId ? [operation.operationId] : [];
        }),
      )
      .sort(),
    ["createTodo", "getTodo", "listTodos"],
  );
});

test(
  "the example serves pages, API routes, and its client form",
  { timeout: 120000 },
  async () => {
    execFileSync("npm", ["run", "build"], { cwd: example, stdio: "pipe" });

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: example,
      env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
      stdio: "ignore",
    });
    const browser = await chromium.launch();

    try {
      for (let i = 0; ; i++) {
        try {
          await fetch(base + "/api/todos");
          break;
        } catch (error) {
          if (i > 100) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const list = await fetch(base + "/api/todos");

      assert.equal(list.headers.get("cache-control"), "no-store");
      assert.equal((await list.json()).length, 2);
      assert.equal((await fetch(base + "/api/todos/99")).status, 404);
      assert.equal((await fetch(base + "/todos/99")).status, 404);
      assert.equal(
        (await (await fetch(base + "/api/openapi")).json()).info.title,
        "Todos",
      );

      const page = await browser.newPage();
      const errors: string[] = [];

      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await expect(page.getByRole("listitem")).toHaveCount(2);

      // The client component posts to the API, then revalidates the server component.
      await page.getByLabel("New todo").fill("Write tests");
      await page.getByRole("button", { name: "Add" }).click();
      await expect(
        page.getByRole("link", { name: "Write tests" }),
      ).toBeVisible();

      // Client navigation keeps the document and loads the todo's page data.
      await page.getByRole("link", { name: "Write tests" }).click();
      await expect(
        page.getByRole("heading", { name: "Write tests" }),
      ).toBeVisible();
      await expect(page).toHaveTitle("Write tests · Todos");
      await page.getByRole("link", { name: "About" }).click();
      await expect(page).toHaveURL(base + "/about");
      await expect(page).toHaveTitle("About · Todos");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      child.kill();
    }
  },
);
