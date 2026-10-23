import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, get, type RequestListener } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { sendResponse } from "../packages/vite-express-rsc/dist/runtime/response.js";

/** Start a local HTTP fixture and expose a cleanup function. */
async function listen(handler: RequestListener) {
  const server = createServer(handler);

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  return {
    url: `http://127.0.0.1:${address.port}`,
    /** Close test connections and stop the fixture listener. */
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("renderer transport preserves cookies and streams before completion", async () => {
  const server = await listen((_req, res) => {
    const body = new ReadableStream<Uint8Array>({
      /** Produce two delayed chunks to verify that the response is actually streamed. */
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
        await delay(150);
        controller.enqueue(new TextEncoder().encode("last"));
        controller.close();
      },
    });
    const headers = new Headers();

    headers.append("Set-Cookie", "one=1; Path=/");
    headers.append("Set-Cookie", "two=2; Path=/");
    void sendResponse(res, new Response(body, { headers })).catch(() =>
      res.destroy(),
    );
  });

  try {
    const response = await fetch(server.url);

    assert.equal(response.headers.getSetCookie().length, 2);

    const reader = response.body!.getReader();

    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "first",
    );
    assert.equal(new TextDecoder().decode((await reader.read()).value), "last");
    assert.equal((await reader.read()).done, true);
  } finally {
    await server.close();
  }
});

test("disconnect cancels a backpressured renderer without waiting forever for drain", async () => {
  let canceled!: () => void;
  const cancellation = new Promise<void>((resolve) => (canceled = resolve));
  let sent!: () => void;
  const completed = new Promise<void>((resolve) => (sent = resolve));
  const server = await listen((_req, res) => {
    const body = new ReadableStream<Uint8Array>({
      /** Keep producing chunks so the client can create backpressure. */
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      /** Record that disconnecting the client canceled the renderer. */
      cancel() {
        canceled();
      },
    });

    void sendResponse(res, new Response(body)).then(sent, sent);
  });
  const request = get(server.url);

  request.on("error", () => {});

  const [response] = await once(request, "response");

  response.pause();
  await delay(50);
  response.destroy();

  try {
    await Promise.race([
      Promise.all([cancellation, completed]),
      delay(2000, undefined, { ref: false }).then(() => {
        throw new Error("Disconnect left the response pipeline hanging");
      }),
    ]);
  } finally {
    await server.close();
  }
});

test("HEAD cancels its renderer body rather than leaving it unconsumed", async () => {
  let canceled = false;
  const server = await listen((_req, res) => {
    const body = new ReadableStream<Uint8Array>({
      /** Record that a HEAD request canceled its unused response body. */
      cancel() {
        canceled = true;
      },
    });

    void sendResponse(res, new Response(body)).catch(() => res.destroy());
  });

  try {
    assert.equal(
      await (await fetch(server.url, { method: "HEAD" })).text(),
      "",
    );
    assert.equal(canceled, true);
  } finally {
    await server.close();
  }
});
