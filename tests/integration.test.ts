declare global {
  interface Window {
    testDocumentMarker?: string;
    testCspViolations?: string[];
    __reactRouterDataRouter?: import("react-router").DataRouter;
  }
}
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const example = resolve(root, "tests/fixture");
/** Wait briefly before retrying a development update. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry an assertion while the application or Vite update becomes ready. */
async function until<T>(callback: () => T | Promise<T>): Promise<T> {
  let error;

  for (let i = 0; i < 150; i++) {
    try {
      return await callback();
    } catch (e) {
      error = e;
      await pause(100);
    }
  }

  throw error;
}

/** Remove React HTML comments so rendered text is easier to check. */
const text = (html: string) => html.replace(/<!--.*?-->/gs, "");

/** Start a real development or production server on an available port. */
async function start(mode: string, requestedPort = 0) {
  const socket = createServer();

  socket.listen(requestedPort, "127.0.0.1");
  await once(socket, "listening");

  const address = socket.address();

  assert.ok(address && typeof address !== "string");

  const port = address.port;

  await new Promise<void>((resolve) => socket.close(() => resolve()));

  const child = spawn(
    process.execPath,
    mode !== "development"
      ? [resolve(mode === "production-root" ? root : example, "dist/index.js")]
      : [resolve(root, "packages/vite-express-rsc/dist/dev.js")],
    {
      cwd: example,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: mode !== "development" ? "production" : "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";

  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));

  const base = `http://127.0.0.1:${port}`;

  try {
    await until(async () =>
      assert.equal((await fetch(base + "/api/health")).status, 200),
    );
  } catch (e) {
    child.kill();
    throw new Error(logs, { cause: e });
  }

  return { base, child, logs: () => logs };
}

test(
  "clean production build and dev: Express, RSC, browser and live updates",
  { timeout: 180000 },
  async (t) => {
    rmSync(resolve(root, "dist"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });

    // Build a second browser deployment so the real stale-client handshake is exercised.
    const counterFile = resolve(example, "src/app/components/Counter.tsx");
    const counterSource = readFileSync(counterFile, "utf8");

    try {
      writeFileSync(
        counterFile,
        counterSource.replace("<button ", '<button data-deployment="second" '),
      );
      rmSync(resolve(example, "dist"), { recursive: true, force: true });
      execFileSync("npm", ["run", "build"], { cwd: example, stdio: "pipe" });
    } finally {
      writeFileSync(counterFile, counterSource);
    }

    const browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
      args: process.env.PLAYWRIGHT_SINGLE_PROCESS
        ? ["--single-process", "--no-zygote"]
        : [],
    });
    const page = await browser.newPage();

    await page.addInitScript(() => {
      window.testCspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.testCspViolations!.push(event.violatedDirective);
      });
    });

    try {
      for (const mode of ["production", "production-root", "development"]) {
        await t.test(mode, async () => {
          const server = await start(mode);
          const { base, child } = server;

          try {
            const operation = await fetch(base + "/operations/42");

            assert.deepEqual(await operation.json(), {
              id: "42",
              order: ["global", "module", "get"],
              operationId: "getOperation",
            });

            const head = await fetch(base + "/operations/42", {
              method: "HEAD",
            });

            assert.equal(head.status, 200);
            assert.equal(head.headers.get("x-method-guard"), "get");

            const methodDenied = await fetch(base + "/operations/42", {
              method: "POST",
            });

            assert.equal(methodDenied.status, 403);
            assert.equal(methodDenied.headers.get("x-method-guard"), null);

            const options = await fetch(base + "/operations/42", {
              method: "OPTIONS",
            });

            assert.equal(options.status, 200);
            assert.equal(options.headers.get("x-method-guard"), null);

            const streamed = await fetch(base + "/streaming");
            const reader = streamed.body!.getReader();
            let streamedHTML = "";

            while (!streamedHTML.includes("Stream pending")) {
              const chunk = await reader.read();

              assert.equal(chunk.done, false);
              streamedHTML += new TextDecoder().decode(chunk.value);
            }

            assert.ok(!streamedHTML.includes("Stream completed"));

            while (true) {
              const chunk = await reader.read();

              if (chunk.done) {
                break;
              }

              streamedHTML += new TextDecoder().decode(chunk.value);
            }

            assert.match(streamedHTML, /Stream completed/);

            const canceledBefore = await (
              await fetch(base + "/streaming/status")
            ).json();
            const abort = new AbortController();
            const disconnect = await fetch(base + "/streaming", {
              signal: abort.signal,
            });

            await disconnect.body!.getReader().read();
            abort.abort();
            await until(async () => {
              assert.equal(child.exitCode, null);

              const after = await (
                await fetch(base + "/streaming/status")
              ).json();

              assert.equal(after.canceled, canceledBefore.canceled + 1);
            });

            // Repeated concurrent streams must all finish or cancel, leaving no active work.
            const beforeLoad = await (
              await fetch(base + "/streaming/status")
            ).json();

            for (let round = 0; round < 3; round++) {
              await Promise.all(
                Array.from({ length: 12 }, async (_, i) => {
                  const controller = new AbortController();
                  const response = await fetch(base + "/streaming", {
                    signal: controller.signal,
                  });

                  if (i % 2 === 0) {
                    const reader = response.body!.getReader();
                    let body = "";

                    while (!body.includes("Stream pending")) {
                      const chunk = await reader.read();

                      assert.equal(chunk.done, false);
                      body += new TextDecoder().decode(chunk.value);
                    }

                    controller.abort();
                  } else {
                    assert.match(await response.text(), /Stream completed/);
                  }
                }),
              );
            }

            await until(async () => {
              const afterLoad = await (
                await fetch(base + "/streaming/status")
              ).json();

              assert.equal(afterLoad.started - beforeLoad.started, 36);
              assert.equal(afterLoad.completed - beforeLoad.completed, 18);
              assert.equal(afterLoad.canceled - beforeLoad.canceled, 18);
              assert.equal(
                afterLoad.started,
                afterLoad.completed + afterLoad.canceled,
              );
              assert.equal(child.exitCode, null);
            });

            const documentResponse = await fetch(base);

            assert.equal(documentResponse.status, 200);
            assert.match(
              documentResponse.headers.get("content-type")!,
              /text\/html/,
            );

            const html = text(await documentResponse.text());

            assert.match(html, /Users: 27/);

            if (mode !== "development") {
              assert.match(
                documentResponse.headers.get("content-security-policy")!,
                /script-src 'nonce-/,
              );
            }

            assert.match(html, /<title>Express \+ Vite RSC<\/title>/);
            assert.equal(
              documentResponse.headers.get("x-root-middleware"),
              "yes",
            );
            assert.match(html, /Loading database/);

            // Index/trailing-slash RSC URLs must run the same guards as documents.
            for (const path of ["/_.rsc", "/dashboard/_.rsc"]) {
              const response = await fetch(base + path);

              assert.equal(response.status, 200, path);
              assert.match(
                response.headers.get("content-type") ?? "",
                /text\/x-component/,
              );
            }

            const navigation = await fetch(base + "/dashboard/users/42.rsc");

            assert.equal(navigation.status, 200);
            assert.match(
              navigation.headers.get("content-type")!,
              /text\/x-component/,
            );
            assert.match(await navigation.text(), /42/);

            const dynamic = text(
              await (await fetch(base + "/dashboard/users/42")).text(),
            );

            assert.match(dynamic, /Dashboard layout/);
            assert.match(dynamic, /User ID: 42/);
            assert.match(
              await (await fetch(base + "/about")).text(),
              /Pathless route group/,
            );
            assert.match(
              text(await (await fetch(base + "/docs/a/b")).text()),
              /Documentation: a\/b/,
            );
            assert.equal((await fetch(base + "/missing")).status, 404);
            assert.equal((await fetch(base, { method: "POST" })).status, 405);
            assert.equal(
              (await fetch(base + "/api/users/42", { method: "DELETE" }))
                .status,
              204,
            );
            assert.equal(
              (await fetch(base + "/api/users/42", { method: "HEAD" })).status,
              200,
            );
            assert.equal(
              (await fetch(base + "/api/users/42", { method: "OPTIONS" }))
                .status,
              200,
            );

            const posted = await fetch(base + "/api/users/42", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: '{"native":true}',
            });

            assert.equal(posted.status, 201);
            assert.deepEqual(await posted.json(), { native: true });

            for (let i = 0; i < 2; i++) {
              assert.deepEqual(
                await (await fetch(base + "/api/users/42")).json(),
                { id: "42", order: ["global", "users", "route"] },
              );
            }

            assert.deepEqual(
              await (await fetch(base + "/api/users/42/posts/99")).json(),
              {
                params: { id: "42", postId: "99" },
                order: ["global", "users"],
              },
            );
            assert.deepEqual(await (await fetch(base + "/api/health")).json(), {
              order: ["global"],
            });

            const failure = await fetch(base + "/api/failure");

            assert.equal(failure.status, 500);
            assert.deepEqual(await failure.json(), {
              error: "Expected API failure",
            });

            const failedPage = await fetch(base + "/failure");

            assert.equal(failedPage.status, 500);
            await Promise.all(
              Array.from({ length: 20 }, async (_, i) => {
                const id = `request-${i}`;
                const body = text(
                  await (
                    await fetch(base, {
                      headers: { "x-user": `user-${i}`, "x-request-id": id },
                    })
                  ).text(),
                );

                assert.match(
                  body,
                  new RegExp(`user: user-${i}; request: ${id}/${id}`),
                );
              }),
            );
            await Promise.all(
              Array.from({ length: 20 }, async (_, i) => {
                const requestId = `native-${i}`;
                const response = await fetch(base + "/api/native", {
                  headers: {
                    "x-user": `native-user-${i}`,
                    "x-request-id": requestId,
                  },
                });

                assert.equal(response.status, 200);
                assert.equal(
                  response.headers.get("X-Context-Request"),
                  requestId,
                );
                assert.deepEqual(await response.json(), {
                  requestId,
                  user: `native-user-${i}`,
                  stable: true,
                  markup: `<span>${requestId}</span>`,
                });
              }),
            );

            // Inherited middleware gates every endpoint before data or rendering work.
            await fetch(base + "/api/probe", { method: "POST" });

            const denied = await fetch(base + "/guarded", {
              redirect: "manual",
            });

            assert.equal(denied.status, 302);
            assert.equal(denied.headers.get("location"), "/login");
            assert.equal(denied.headers.getSetCookie().length, 2);

            const deniedFlight = await fetch(base + "/guarded.rsc", {
              redirect: "manual",
            });

            assert.equal(deniedFlight.status, 202);

            const partialDenied = await fetch(
              base + "/guarded/details.rsc?_routes=page%3Aguarded%2Fdetails",
            );

            assert.equal(partialDenied.status, 202);
            assert.match(await partialDenied.text(), /redirect/);

            assert.match(await deniedFlight.text(), /redirect/);
            assert.equal(
              (await fetch(base + "/guarded/download", { redirect: "manual" }))
                .status,
              302,
            );
            assert.deepEqual(await (await fetch(base + "/api/probe")).json(), {
              layoutLoads: 0,
              pageLoads: 0,
              metadataCalls: 0,
              renders: 0,
            });

            const allowed = await fetch(base + "/guarded?q=example", {
              headers: { "x-user": "member" },
            });

            assert.equal(allowed.status, 200);
            assert.equal(
              allowed.headers.get("x-page-loader"),
              "native-express",
            );
            assert.ok(
              allowed.headers
                .getSetCookie()
                .some((value) => value.startsWith("loaded=yes")),
            );

            const privateHTML = text(await allowed.text());

            assert.match(
              privateHTML,
              /<title>Member member · Account<\/title>/,
            );
            assert.match(
              privateHTML,
              /name="description" content="Member profile"/,
            );
            assert.match(privateHTML, /rel="canonical" href="\/guarded"/);
            assert.match(
              privateHTML,
              /property="og:site_name" content="Express RSC"/,
            );
            assert.match(
              privateHTML,
              /property="og:image" content="\/member.png"/,
            );
            assert.ok(!privateHTML.includes('content="/default.png"'));
            assert.match(privateHTML, /noindex, nofollow/);
            assert.match(
              privateHTML,
              /global.*directory.*layout-a.*layout-b.*endpoint.*layout-loader.*page-loader/,
            );
            await fetch(base + "/api/probe", { method: "POST" });
            assert.deepEqual(
              await (
                await fetch(base + "/guarded/download", {
                  headers: { "x-user": "member" },
                })
              ).json(),
              {
                download: true,
                params: {},
                order: [
                  "global",
                  "directory",
                  "layout-a",
                  "layout-b",
                  "endpoint",
                ],
              },
            );
            assert.deepEqual(await (await fetch(base + "/api/probe")).json(), {
              layoutLoads: 0,
              pageLoads: 0,
              metadataCalls: 0,
              renders: 0,
            });
            assert.match(
              await (await fetch(base + "/shared")).text(),
              /Page and POST endpoint/,
            );

            const shared = await fetch(base + "/shared", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: '{"value":1}',
            });

            assert.equal(shared.status, 201);
            assert.deepEqual(await shared.json(), {
              shared: true,
              body: { value: 1 },
            });

            const slow = text(
              await (await fetch(base + "/reports/slow")).text(),
            );

            assert.match(slow, /Loading report segment/);
            assert.match(slow, /Finished report/);

            const loaderError = await fetch(base + "/reports/loader-error");

            assert.equal(loaderError.status, 500);

            const loaderErrorHTML = await loaderError.text();

            assert.match(loaderErrorHTML, /Report failed/);
            assert.ok(!loaderErrorHTML.includes("Must never render"));
            assert.match(
              await (await fetch(base + "/reports/broken")).text(),
              /Report failed/,
            );

            const blocked = await fetch(base + "/reports/denied");

            assert.equal(blocked.status, 403);

            const blockedHTML = await blocked.text();

            assert.match(blockedHTML, /Report failed/);
            assert.ok(
              !blockedHTML.includes("Forbidden component must never render"),
            );

            const blockedRaw = await fetch(base + "/reports/denied/raw");

            assert.equal(blockedRaw.status, 403);
            assert.deepEqual(await blockedRaw.json(), {
              error: "Access denied",
            });
            assert.equal(
              (await (await fetch(base + "/api/probe")).json()).pageLoads,
              0,
            );

            const blockedPartial = await fetch(
              base + "/reports/denied.rsc?_routes=layout%3A",
            );

            assert.equal(blockedPartial.status, 403);
            await blockedPartial.text();

            const blockedPost = await fetch(base + "/reports/denied", {
              method: "POST",
            });

            assert.equal(blockedPost.status, 403);
            assert.deepEqual(await blockedPost.json(), {
              error: "Access denied",
            });

            const redirected = await fetch(base + "/redirected", {
              redirect: "manual",
            });

            assert.equal(redirected.status, 302);
            assert.equal(redirected.headers.get("location"), "/login");
            assert.ok(
              redirected.headers
                .getSetCookie()
                .some((value) => value.startsWith("loader-redirect=yes")),
            );

            const redirectedRSC = await fetch(base + "/redirected.rsc");

            assert.equal(redirectedRSC.status, 202);
            assert.match(await redirectedRSC.text(), /redirect/);

            for (const method of [
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ]) {
              const response = await fetch(base + "/methods?native=yes", {
                method,
                ...(["POST", "PUT", "PATCH"].includes(method)
                  ? {
                      headers: { "Content-Type": "application/json" },
                      body: '{"value":7}',
                    }
                  : {}),
              });

              assert.equal(response.status, 200);
              assert.equal(response.headers.get("x-root-middleware"), "yes");
              assert.equal(response.headers.get("x-native-method"), method);

              if (method !== "HEAD") {
                const data = await response.json();

                assert.equal(data.method, method);
                assert.deepEqual(data.query, { native: "yes" });

                if (["POST", "PUT", "PATCH"].includes(method)) {
                  assert.deepEqual(data.body, { value: 7 });
                }
              }
            }

            const sharedOptions = await fetch(base + "/shared", {
              method: "OPTIONS",
            });

            for (const method of ["GET", "HEAD", "POST"]) {
              assert.ok(sharedOptions.headers.get("allow")!.includes(method));
            }

            assert.equal(
              (await fetch(base + "/api/health", { method: "PUT" })).status,
              404,
            );
            assert.equal((await fetch(base + "/dashboard/users")).status, 404);
            assert.equal((await fetch(base + "/api/users/42.rsc")).status, 404);
            await fetch(base + "/api/probe", { method: "POST" });
            assert.equal(
              (
                await fetch(base + "/guarded", {
                  method: "POST",
                  headers: { "x-user": "member" },
                })
              ).status,
              405,
            );
            assert.deepEqual(await (await fetch(base + "/api/probe")).json(), {
              layoutLoads: 0,
              pageLoads: 0,
              metadataCalls: 0,
              renders: 0,
            });

            const deniedSplat = await fetch(
              base + "/docs/a/b.rsc?_routes=page%3Adocs%2F%5B...slug%5D",
              { headers: { "x-block-splat": "yes" } },
            );

            assert.equal(deniedSplat.status, 403);
            assert.equal(
              (await (await fetch(base + "/api/probe")).json()).renders,
              0,
            );

            const errors: string[] = [];
            /** Collect browser errors so the test can assert that hydration stayed healthy. */
            const onError = (e: Error) => errors.push(e.message);

            page.on("pageerror", onError);
            await page.goto(base);
            await page.waitForFunction(() => !!window.__reactRouterDataRouter);
            await page
              .getByRole("button", { name: "Count: 0", exact: true })
              .click();
            await expect(page.getByRole("button")).toHaveText("Count: 1");
            await page.evaluate(() => {
              window.testDocumentMarker = "persistent";
            });
            await page
              .getByRole("link", { name: "Dashboard", exact: true })
              .click();
            await expect(page.locator("main")).toContainText("Dashboard users");
            await page.evaluate(() => {
              document.querySelector<HTMLElement>(
                '[data-layout="dashboard"]',
              )!.dataset.marker = "persistent";
            });
            await page
              .getByRole("link", { name: "User 42", exact: true })
              .click();
            await expect(page.locator("main")).toContainText("User ID: 42");
            assert.equal(
              await page.evaluate(() => window.testDocumentMarker),
              "persistent",
            );
            assert.equal(
              await page
                .locator('[data-layout="dashboard"]')
                .getAttribute("data-marker"),
              "persistent",
            );
            await expect(page.getByRole("button")).toHaveText("Count: 1");
            await page.reload();
            await expect(page.locator("main")).toContainText("User ID: 42");
            await expect(page).toHaveTitle("User 42 · Express + Vite RSC");
            await page.evaluate(() => {
              window.testDocumentMarker = "persistent";
            });
            await page.setExtraHTTPHeaders({ "x-user": "member" });
            await page
              .getByRole("link", { name: "Account", exact: true })
              .click();
            await expect(
              page.getByRole("heading", { name: "Private member page" }),
            ).toBeVisible();
            await expect(page).toHaveTitle("Member member · Account");
            await page.evaluate(() => {
              document.querySelector<HTMLElement>(
                '[data-layout="guarded"]',
              )!.dataset.marker = "persistent";
            });
            await page
              .getByRole("link", { name: "Account details", exact: true })
              .click();
            await expect(page.locator("main")).toContainText("Private details");
            await expect(page).toHaveTitle("Details · Account");
            assert.equal(
              await page
                .locator('[data-layout="guarded"]')
                .getAttribute("data-marker"),
              "persistent",
            );
            await expect(page.locator('meta[name="description"]')).toHaveCount(
              0,
            );
            await expect(page.locator('meta[property="og:image"]')).toHaveCount(
              0,
            );
            await page.setExtraHTTPHeaders({});
            await page
              .getByRole("link", { name: "Account", exact: true })
              .click();
            await expect(page).toHaveURL(base + "/login");
            await expect(
              page.getByRole("heading", { name: "Login", exact: true }),
            ).toBeVisible();
            await expect(page).toHaveTitle("Express + Vite RSC");
            assert.equal(
              await page.evaluate(() => window.testDocumentMarker),
              "persistent",
            );
            await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
            page.off("pageerror", onError);
            assert.deepEqual(errors, []);
            assert.deepEqual(
              await page.evaluate(() => window.testCspViolations),
              [],
            );

            if (mode === "development") {
              // Server restarts intentionally close connections; test code edits on a fresh document.
              await page.goto("about:blank");

              const route = resolve(example, "src/app/api/health/route.ts");
              const original = readFileSync(route, "utf8");

              try {
                writeFileSync(
                  route,
                  original.replace(
                    /\{\s*order:\s*res\.locals\.order\s*\}/,
                    "{updated:true}",
                  ),
                );
                await until(async () =>
                  assert.deepEqual(
                    await (await fetch(base + "/api/health")).json(),
                    { updated: true },
                  ),
                );
              } finally {
                writeFileSync(route, original);
                await until(async () =>
                  assert.deepEqual(
                    await (await fetch(base + "/api/health")).json(),
                    { order: ["global"] },
                  ),
                );
              }

              const added = resolve(example, "src/app/live-test");

              try {
                mkdirSync(added);
                writeFileSync(
                  resolve(added, "page.tsx"),
                  "export default function Page(){return <p>Added live route</p>}",
                );
                await until(async () =>
                  assert.ok(
                    (await (await fetch(base + "/live-test")).text()).includes(
                      "Added live route",
                    ),
                    "Added route missing",
                  ),
                );
              } finally {
                rmSync(added, { recursive: true, force: true });
                await until(async () =>
                  assert.equal((await fetch(base + "/live-test")).status, 404),
                );
              }

              const counter = resolve(
                example,
                "src/app/components/Counter.tsx",
              );
              const counterSource = readFileSync(counter, "utf8");

              try {
                await page.goto(base);
                await page.waitForFunction(
                  () => !!window.__reactRouterDataRouter,
                );
                await page.getByRole("button").click();
                await expect(page.getByRole("button")).toHaveText("Count: 1");
                page.on("pageerror", onError);
                writeFileSync(
                  counter,
                  counterSource.replace("Count: ", "Clicks: "),
                );
                await expect(page.getByRole("button")).toContainText(
                  "Clicks:",
                  { timeout: 15000 },
                );
              } finally {
                writeFileSync(counter, counterSource);
                await expect(page.getByRole("button")).toHaveText("Count: 1");
              }

              const home = resolve(example, "src/app/page.tsx");
              const homeSource = readFileSync(home, "utf8");

              try {
                // A normal incomplete save must not poison Vite's restart lifecycle.
                const diagnosticsBefore = server.logs().length;

                page.off("pageerror", onError);
                writeFileSync(home, "export default function Page( {");
                await until(() => {
                  assert.match(
                    server.logs().slice(diagnosticsBefore),
                    /Unexpected token/,
                  );
                  assert.equal(child.exitCode, null);
                });
                writeFileSync(
                  home,
                  homeSource.replace(
                    "Server rendered home",
                    "Recovered server home",
                  ),
                );
                await until(async () => {
                  assert.equal(child.exitCode, null);
                  assert.match(
                    await (await fetch(base)).text(),
                    /Recovered server home/,
                  );
                });
                await expect(page.locator("main")).toContainText(
                  "Recovered server home",
                  { timeout: 15000 },
                );

                const count = Number(
                  (await page.getByRole("button").textContent())!.split(
                    ": ",
                  )[1],
                );

                await page.getByRole("button").click();
                await expect(page.getByRole("button")).toHaveText(
                  `Count: ${count + 1}`,
                );
                writeFileSync(
                  home,
                  homeSource.replace(
                    "Server rendered home",
                    "Updated server home",
                  ),
                );
                await until(async () =>
                  assert.ok(
                    (await (await fetch(base)).text()).includes(
                      "Updated server home",
                    ),
                  ),
                );
                await expect(page.locator("main")).toContainText(
                  "Updated server home",
                  { timeout: 15000 },
                );
              } finally {
                writeFileSync(home, homeSource);
              }
            }

            page.off("pageerror", onError);
            assert.deepEqual(errors, []);
          } catch (error) {
            console.error(server.logs());
            throw error;
          } finally {
            child.kill("SIGTERM");
            await once(child, "exit");
          }
        });
      }

      await t.test("stale browser reloads after deployment", async () => {
        let server = await start("production-root");

        try {
          await page.goto(server.base);
          await expect(page.getByRole("button")).toHaveText("Count: 0");
          await page.getByRole("button").click();
          await expect(page.getByRole("button")).toHaveText("Count: 1");
          await page.evaluate(() => {
            window.testDocumentMarker = "old deployment";
          });

          const port = Number(new URL(server.base).port);

          server.child.kill("SIGTERM");
          await once(server.child, "exit");
          server = await start("production", port);

          // Revalidation uses an already known route, exercising the payload version check.
          await page.evaluate(() => {
            void window.__reactRouterDataRouter!.revalidate();
          });
          await page.waitForFunction(
            () => window.testDocumentMarker === undefined,
          );
          await expect(page.getByRole("button")).toHaveAttribute(
            "data-deployment",
            "second",
          );
          await expect(page.getByRole("button")).toHaveText("Count: 0");
          await page.getByRole("button").click();
          await expect(page.getByRole("button")).toHaveText("Count: 1");

          const staleManifest = await fetch(
            server.base + "/.manifest?version=obsolete&paths=/",
          );

          assert.equal(staleManifest.status, 204);
          assert.equal(
            staleManifest.headers.get("X-Remix-Reload-Document"),
            "true",
          );
        } finally {
          if (server.child.exitCode === null) {
            server.child.kill("SIGTERM");
            await once(server.child, "exit");
          }
        }
      });
    } finally {
      await browser.close();
    }
  },
);
