import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { ServerResponse } from "node:http";

/** Send a renderer response to Node and cancel its body when the client disconnects. */
export async function sendResponse(
  res: ServerResponse,
  response: globalThis.Response,
) {
  if (res.destroyed) {
    await response.body?.cancel();

    return;
  }

  res.statusCode = response.status;

  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") {
      res.setHeader(name, value);
    }
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length) {
    res.setHeader("set-cookie", cookies);
  }

  if (res.req.method === "HEAD" || !response.body) {
    await response.body?.cancel();
    res.end();

    return;
  }

  // DOM and Node stream declarations differ; the runtime is Node's native stream.
  const body = response.body as unknown as NodeReadableStream<Uint8Array>;

  await pipeline(Readable.fromWeb(body), res);
}
